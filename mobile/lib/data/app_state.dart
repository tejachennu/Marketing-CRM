import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:uuid/uuid.dart';

import 'backend.dart';
import 'demo_backend.dart';
import 'format.dart';
import 'local_store.dart';
import 'notifier.dart';
import 'push.dart';

const _uuid = Uuid();

/// The app's one source of truth: the signed-in workspace, the lists kept on the phone, and the
/// queue of changes waiting for the internet.
///
/// Offline rules:
/// - Every list is read from the phone first, then refreshed from the server when online.
/// - Every change (a bill, a booking, a contact, a message, a campaign) goes into the outbox and is
///   shown straight away as "Waiting to sync". The outbox is sent in order when the internet is
///   back, on its own (every 30 seconds, when the connection returns, and when the app opens).
/// - Counter actions carry their outbox id as a client reference, so the server does each once
///   even if the same one is sent twice.
/// - Something made offline (a booking) gets a local id; a later change to it (marking it arrived)
///   waits until the server's id is known, then uses that.
/// - When the server refuses a change (say, the time has passed), it stops and shows why, with
///   Try again and Discard.
class AppState extends ChangeNotifier {
  AppState({required this.backend, required this.store});

  final Backend backend;
  final LocalStore store;

  bool online = true;

  /// The chat open on screen (no notification for it).
  String? openChatId;
  Set<String>? _knownBookings;
  bool syncing = false;
  bool refreshing = false;
  DateTime? lastSync;
  String? lastError;
  Timer? _timer;
  Timer? _refreshTimer;
  Timer? _bookingTimer;
  Timer? _bookingSoon;
  Timer? _jobsTimer;
  StreamSubscription? _connectivity;
  StreamSubscription? _auth;

  /// Signing out is under way (the sign-in's own "signed out" news is then expected, not a surprise).
  bool _signingOut = false;

  /// Goes up at each sign-out, so answers still on their way for the old sign-in are dropped, not saved.
  int _session = 0;

  // ── Start up ──

  Future<void> start() async {
    _connectivity = Connectivity().onConnectivityChanged.listen((results) {
      final hasNetwork = results.any((r) => r != ConnectivityResult.none);
      if (hasNetwork) unawaited(Push.instance.dropOldAddress(store));
      if (hasNetwork && !online) {
        online = true;
        notifyListeners();
        syncNow();
      } else if (!hasNetwork) {
        online = false;
        notifyListeners();
      }
    });
    // Every 30 seconds: send what is waiting (that also checks the internet), or else check whether the internet is
    // back. Refused changes (and ones waiting on them) cannot be sent, so they never keep the app looking offline.
    // Every 5 minutes: bring the lists up to date.
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (!backend.signedIn) return;
      if (_hasSendable) {
        unawaited(flush());
      } else if (!online) {
        unawaited(load('me', '/api/mobile/me', force: true));
      }
    });
    _refreshTimer = Timer.periodic(const Duration(minutes: 5), (_) {
      if (backend.signedIn && online) unawaited(refreshAll());
    });
    // Booking requests arrive from WhatsApp: look for new ones every 30 seconds
    _bookingTimer = Timer.periodic(const Duration(seconds: 30), (_) => checkBookings());
    // As on the web counter: every 2 minutes, send what is due (reminders, feedback questions)
    _jobsTimer = Timer.periodic(const Duration(minutes: 2), (_) => unawaited(runDueJobs()));
    // The server ended the sign-in (password changed on the web, removed from the team): back to the sign-in screen
    if (backend case final HttpBackend http) {
      _auth = http.whenSignedOut(() {
        if (!_signingOut && me != null) unawaited(_sessionEnded());
      });
    }
    unawaited(Push.instance.dropOldAddress(store));
    unawaited(Notifier.instance.init());
    if (signedIn) {
      startLive();
      unawaited(syncNow().then((_) => checkBookings()));
      unawaited(startPush());
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _refreshTimer?.cancel();
    _bookingTimer?.cancel();
    _jobsTimer?.cancel();
    backend.stopLive();
    _connectivity?.cancel();
    _auth?.cancel();
    super.dispose();
  }

  bool get signedIn => backend.signedIn && me != null;

  /// Tell the screens something changed (used by the live updates).
  void changed() => notifyListeners();

  Future<void> signIn(String email, String password) async {
    await backend.signIn(email, password);
    await load('me', '/api/mobile/me', force: true, rethrowErrors: true);
    startLive();
    await syncNow();
    await checkBookings();
    unawaited(startPush());
  }

  /// Pop-up notifications when the app is closed (needs the server's Firebase settings).
  Future<void> startPush() => Push.instance.start(backend, store.read('config')?['firebase'] as Map?, store: store);

  /// "Continue with Google". Returns null when signed in, or the name and email to start the
  /// "Name your business" step (a first-time Google account with no workspace yet).
  Future<Map<String, dynamic>?> signInWithGoogle() async {
    await backend.signInWithGoogle();
    if (backend is! DemoBackend) {
      final state = await backend.get('/api/auth/oauth-complete');
      if (state['ready'] != true) return state;
    }
    await _afterSignIn();
    return null;
  }

  /// The "Name your business" step after a first Google sign-in: makes the workspace, then opens the app.
  Future<void> finishGoogleSignUp(String companyName, String fullName, {String phone = ''}) async {
    await backend.send('POST', '/api/auth/oauth-complete', {'companyName': companyName, 'fullName': fullName, if (phone.isNotEmpty) 'phone': phone});
    await store.write('onboarding', {'pending': true});
    await _afterSignIn();
  }

  // ── First steps after sign-up: what the connectors give, then pick one (owner, 25 Nov 2026) ──

  /// A workspace made on this phone that has not picked its connector and plan yet.
  bool get needsOnboarding => store.read('onboarding')?['pending'] == true;

  /// Picked on the last welcome page: the connector ('salon' or 'ecommerce') and with or without their own WhatsApp
  /// (Growth, or Starter at ₹300 where WAMA CRM's number sends confirmations). The free trial carries on either way.
  Future<void> finishOnboarding({required String connector, required bool ownWhatsApp}) async {
    try {
      await ask('/api/billing/change-plan', {'plan': ownWhatsApp ? 'growth' : 'starter'});
    } on ApiException catch (_) {
      // No billing on this server (or exempt): the plan stays as it is
    }
    await ask('/api/connectors', {'key': connector, 'enabled': true});
    await store.write('onboarding', {'pending': false});
    await load('me', '/api/mobile/me', force: true);
    notifyListeners();
    unawaited(refreshAll());
  }

  /// Seen the welcome pages without picking (they can pick later in More → Connectors).
  Future<void> skipOnboarding() async {
    await store.write('onboarding', {'pending': false});
    notifyListeners();
  }

  Future<void> _afterSignIn() async {
    await load('me', '/api/mobile/me', force: true, rethrowErrors: true);
    startLive();
    await syncNow();
    await checkBookings();
    unawaited(startPush());
    notifyListeners();
  }

  // ── Sign up (with the code emailed to them) ──

  /// Check the form and email a 6-digit code. Returns how long until another can be sent.
  /// Email the sign-up code. Null = the server needs no code (switched off): create the account straight away.
  Future<int?> sendSignupCode(Map<String, String> form) async {
    final data = await backend.send('POST', '/api/auth/signup/send-code', form);
    if (data['codeNeeded'] == false) return null;
    return (data['resendAfterSeconds'] as num?)?.toInt() ?? 60;
  }

  /// Make the account with the code, then sign in. If the account was made but signing in fails (the internet
  /// dropped), the code is already used: say so, so they sign in instead of trying the code again.
  Future<void> createAccount(Map<String, String> form, String code) async {
    await backend.send('POST', '/api/auth/signup', {...form, if (code.isNotEmpty) 'code': code});
    await store.write('onboarding', {'pending': true});
    try {
      await signIn(form['email']!, form['password']!);
    } catch (_) {
      throw AccountReadyException();
    }
  }

  // ── Things that need the internet now (AI, files) ──

  /// Ask the server and wait for the answer. Offline: says it needs the internet. [timeout]: when the route needs
  /// longer than usual (the usual waits per route are in HttpBackend.timeoutFor).
  Future<Map<String, dynamic>> ask(String path, Map<String, dynamic> body, {String method = 'POST', Duration? timeout}) async {
    try {
      final data = await backend.send(method, path, {if (orgId.isNotEmpty) 'organizationId': orgId, ...body}, timeout: timeout);
      _markOnline();
      return data;
    } on SlowServerException {
      // The server is still at it (publishing a post, writing with AI): not offline, and better not tapped again at once
      rethrow;
    } on OfflineException {
      _markOffline();
      throw OfflineException('This needs the internet. Try again when you are online.');
    } on ApiException catch (e) {
      _onPaused(e);
      rethrow;
    }
  }

  Future<Map<String, dynamic>> uploadFile(List<int> bytes, String filename, {String path = '/api/media/upload', Map<String, String> fields = const {}}) async {
    try {
      final data = await backend.upload(path, bytes, filename, fields: fields);
      _markOnline();
      return data;
    } on SlowServerException {
      throw SlowServerException('The file is taking too long to send. Try again on a better connection.');
    } on OfflineException {
      _markOffline();
      throw OfflineException('Sending a file needs the internet.');
    }
  }

  /// Sign out, with or without internet: the phone's copy and queue always go, and answers still on their way are dropped.
  Future<void> signOut() async {
    _signingOut = true;
    _session++;
    backend.stopLive();
    _knownBookings = null;
    try {
      await Push.instance.stop(backend, store);
      await backend.signOut();
    } finally {
      await store.clear();
      _signingOut = false;
      notifyListeners();
    }
  }

  /// The server ended the sign-in (it could not be renewed, or the account is no longer in a workspace): back to the
  /// sign-in screen. Customer lists leave the phone; changes still waiting stay for that same person's next sign-in.
  Future<void> _sessionEnded() async {
    if (_signingOut) return;
    _signingOut = true;
    _session++;
    backend.stopLive();
    _knownBookings = null;
    try {
      final userId = me?['user']?['id'];
      await Push.instance.stop(backend, store);
      if (backend.signedIn) await backend.signOut();
      if (userId != null) {
        await store.clear(keepOutbox: true);
        await store.write('outbox_owner', {'userId': '$userId'});
      }
    } finally {
      _signingOut = false;
      notifyListeners();
    }
  }

  // ── Who and where ──

  Map<String, dynamic>? get me => store.read('me');
  String get orgId => me?['organization']?['id']?.toString() ?? '';
  String get orgName => me?['organization']?['name']?.toString() ?? 'Workspace';
  bool can(String what) => me?['can']?[what] == true;
  bool get frontDeskOn => me?['connectors']?['frontDesk'] == true;
  bool get storeOn => me?['connectors']?['ecommerce'] == true;

  /// Front Desk: the business takes appointments (Setup → Appointments). Off for shops that only bill walk-ins: the
  /// app then shows no Bookings / Requests tabs, no Book button and no booking setup. A change still waiting to be
  /// sent wins, then the setup copy on the phone, then the profile; an older server that does not say counts as on.
  bool get takesAppointments {
    for (final item in pending('settings').reversed) {
      if (item.body.containsKey('takes_appointments')) return item.body['takes_appointments'] != false;
    }
    final settings = cached('setup')?['settings'];
    if (settings is Map && settings.containsKey('takes_appointments')) return settings['takes_appointments'] != false;
    return me?['frontDesk']?['appointments'] != false;
  }

  /// The business's WhatsApp number is connected. Until it is, chats, campaigns, templates, tickets and the
  /// booking flow are locked (an older server that does not say counts as connected).
  bool get whatsappOn => me?['whatsapp']?['connected'] != false;

  /// Starter sends bookings, bills and reminders through WAMA's own number (no own number needed for those).
  bool get sharedWhatsApp => me?['whatsapp']?['mode'] == 'shared';

  // ── Free trial and plan ──

  /// The free trial or plan has ended: the app shows "Choose a plan" (the server refuses everything but Billing
  /// until then). An older server that does not say counts as open.
  bool get paused => me?['billing']?['hasAccess'] == false;

  /// On the free trial: the days left (0 = ends today). Null when paying, exempt or not said.
  int? get trialDaysLeft => me?['billing']?['onTrial'] == true && me?['billing']?['hasAccess'] != false ? (me?['billing']?['trialDaysLeft'] as num?)?.toInt() : null;

  /// The trial ended (rather than a paid plan): changes the words on the paused screen.
  bool get trialEnded => paused && me?['billing']?['onTrial'] == true;

  /// The server said the workspace is paused (402): read the profile again so the app shows the plan screen.
  void _onPaused(ApiException e) {
    if (e.status == 402 && !paused) unawaited(load('me', '/api/mobile/me', force: true));
  }

  // ── Chats: WhatsApp and Instagram are two lists, never mixed (owner's rule) ──

  /// The phone's copy of each channel's chat list.
  static const chatLists = {'whatsapp': 'conversations', 'instagram': 'ig_conversations'};

  /// Instagram is connected (or has chats already): it gets its own section.
  bool get instagramOn => me?['instagram']?['connected'] == true || chatsOf('instagram').isNotEmpty;
  String get instagramUsername => '${me?['instagram']?['username'] ?? ''}';

  /// One channel's chats, newest first. Checked again here, so an old mixed copy on the phone never shows
  /// an Instagram chat among WhatsApp ones (or the other way round).
  List<Map<String, dynamic>> chatsOf(String channel) {
    final ig = channel == 'instagram';
    return [
      for (final c in (cached(chatLists[channel]!)?['conversations'] as List? ?? const []))
        if (isInstagramChat(c as Map) == ig) Map<String, dynamic>.from(c),
    ];
  }

  static bool isInstagramChat(Map c) => c['channel'] == 'instagram' || '${(c['contact'] as Map?)?['phone_number'] ?? ''}'.startsWith('ig:');

  /// The chat with this id, from whichever list has it.
  Map<String, dynamic>? findChat(String id) {
    for (final channel in chatLists.keys) {
      for (final c in chatsOf(channel)) {
        if (c['id'] == id) return c;
      }
    }
    return null;
  }

  /// Unread messages in one channel's chats.
  int unreadIn(String channel) => chatsOf(channel).where((c) => ((c['unread_count'] as num?) ?? 0) > 0).length;

  Future<void> loadChats(String channel) => load(chatLists[channel]!, '/api/conversations', query: {'limit': '50', 'channel': channel}, force: true);

  // ── Lists kept on the phone ──

  Map<String, dynamic>? cached(String key) => store.read(key);
  DateTime? savedAt(String key) => store.savedAt(key);

  /// Fetch a list from the server into the phone. Offline: keep the copy already there.
  Future<void> load(String key, String path, {Map<String, String>? query, bool force = false, bool rethrowErrors = false}) async {
    if (!force && !online && store.read(key) != null) return;
    final session = _session;
    _loading.add(key);
    if (path == '/api/salon/invoices') _billLists[key] = query ?? const {};
    final seq = _loadSeq[key] = (_loadSeq[key] ?? 0) + 1;
    try {
      final data = await backend.get(path, {if (orgId.isNotEmpty) 'organizationId': orgId, ...?query});
      if (session != _session) return; // signed out meanwhile: nothing of it stays on the phone
      // A newer fetch of this list started meanwhile (say, after a change was sent): its answer counts, not this older one
      if (_loadSeq[key] != seq) return;
      if (chatLists.containsValue(key)) _shortenChatMedia(data['conversations']);
      await store.write(key, data);
      _markOnline();
      notifyListeners();
    } on OfflineException {
      if (session == _session) _markOffline();
      if (rethrowErrors) rethrow;
    } on ApiException catch (e) {
      if (session != _session) {
        if (rethrowErrors) rethrow;
        return;
      }
      lastError = e.message;
      // "Your account is not part of a workspace" (removed from the team): nothing here can work, so sign out
      if (key == 'me' && e.status == 403) unawaited(_sessionEnded());
      if (key != 'me') _onPaused(e);
      notifyListeners();
      if (rethrowErrors) rethrow;
    } finally {
      if (_loading.remove(key)) notifyListeners();
    }
  }

  final Set<String> _loading = {};

  /// The newest fetch started for each list.
  final Map<String, int> _loadSeq = {};

  /// The bills lists (date ranges) fetched this session, to fetch again after a bill changes.
  final Map<String, Map<String, String>> _billLists = {};

  /// Nothing on the phone yet and it is being fetched: show the loading shapes.
  bool isLoading(String key) => store.read(key) == null && (_loading.contains(key) || (refreshing && online));

  static String dayKey(String date) => 'day:$date';

  /// Customer photos and files arrive as data: links of several MB. A chat list only needs to know there is one (and
  /// what kind), so the copy kept on the phone holds just the start of the link; the chat itself keeps the whole file.
  static Object? _shortMedia(Object? url) {
    if (url is! String || !url.startsWith('data:')) return url;
    final comma = url.indexOf(',');
    return comma < 0 ? 'data:' : url.substring(0, comma + 1);
  }

  static void _shortenChatMedia(Object? conversations) {
    if (conversations is! List) return;
    for (final c in conversations) {
      final last = c is Map ? c['last_message'] : null;
      if (last is Map && last['media_url'] != null) last['media_url'] = _shortMedia(last['media_url']);
    }
  }

  Future<void>? _refreshRun;

  /// Bring every list up to date. A call while one is running waits for that one.
  Future<void> refreshAll() => _refreshRun ??= _refreshAll().whenComplete(() => _refreshRun = null);

  Future<void> _refreshAll() async {
    refreshing = true;
    notifyListeners();
    try {
      await load('me', '/api/mobile/me', force: true);
      // Paused (trial or plan ended): nothing else would load until a plan is chosen
      if (!online || paused) return;
      await Future.wait([
        if (frontDeskOn) ...[
          load('setup', '/api/salon/setup', force: true),
          load(dayKey(istToday()), '/api/salon/appointments', query: {'date': istToday()}, force: true),
          load('invoices', '/api/salon/invoices', query: {'preset': 'week'}, force: true),
        ],
        load('contacts', '/api/contacts', query: {'limit': '500', 'fields': 'basic'}, force: true),
        loadChats('whatsapp'),
        loadChats('instagram'),
        load('templates', '/api/whatsapp-templates', query: const {'drafts': '1'}, force: true),
        if (can('campaigns')) load('campaigns', '/api/campaigns', query: {'limit': '30'}, force: true),
        load('knowledge', '/api/knowledge', force: true),
        load('tickets', '/api/tickets', force: true),
      ]);
      if (online) {
        await _prefetchChats();
        lastSync = DateTime.now();
      }
    } finally {
      refreshing = false;
      notifyListeners();
    }
  }

  /// Keep the latest chats on the phone, so they can be read and answered offline too.
  /// Only chats with something new since they were last saved are fetched.
  Future<void> _prefetchChats() async {
    final conversations = [...chatsOf('whatsapp').take(10), ...chatsOf('instagram').take(5)];
    final stale = conversations.where((c) {
      final saved = savedAt('messages:${c['id']}');
      final last = DateTime.tryParse('${c['last_message_at']}');
      return saved == null || (last != null && last.isAfter(saved));
    });
    await Future.wait([
      for (final c in stale) load('messages:${c['id']}', '/api/messages', query: {'conversationId': '${c['id']}', 'limit': '60'}, force: true),
    ]);
    // Only the latest chats' messages stay on the phone (old chats' photos and files would slowly fill it up)
    final keep = {
      for (final c in [...chatsOf('whatsapp').take(30), ...chatsOf('instagram').take(15)]) 'messages:${c['id']}',
      'messages:$openChatId',
    };
    await store.removeWhere((key) => key.startsWith('messages:') && !keep.contains(key));
  }

  /// Send what is waiting, then bring every list up to date.
  Future<void> syncNow() async {
    if (!backend.signedIn) return;
    await flush();
    await refreshAll();
  }

  void _markOffline() {
    if (online) {
      online = false;
      notifyListeners();
    }
  }

  void _markOnline() {
    if (!online) {
      online = true;
      unawaited(flush());
    }
  }

  // ── The outbox ──

  List<OutboxItem> get outbox => store.outbox();
  List<OutboxItem> pending(String kind) => outbox.where((i) => i.kind == kind).toList();
  int get waitingCount => outbox.length;
  int get failedCount => outbox.where((i) => i.state == OutboxState.failed).length;

  /// Whether the waiting changes are worth showing (the strip under the title, the badge on More): offline, one the
  /// server refused, or one waiting over a minute. Online they go out within moments, so nothing flashes after a tap.
  bool get syncWorthShowing =>
      waitingCount > 0 && (!online || failedCount > 0 || outbox.any((i) => DateTime.now().difference(i.createdAt) > const Duration(minutes: 1)));

  static String newLocalId() => 'local_${_uuid.v4().replaceAll('-', '')}';

  /// Queue a change and try to send it now.
  Future<OutboxItem> enqueue({
    required String kind,
    required String label,
    required String path,
    required Map<String, dynamic> body,
    String method = 'POST',
    String? localId,
    String? resultIdPath,
  }) async {
    final item = OutboxItem(id: _uuid.v4(), kind: kind, label: label, method: method, path: path, body: body, createdAt: DateTime.now(), localId: localId, resultIdPath: resultIdPath);
    await store.putOutbox(item);
    notifyListeners();
    unawaited(flush());
    return item;
  }

  /// A Front Desk counter action (bill, booking, status, payment), done once by the server.
  Future<OutboxItem> counterAction({required String kind, required String label, required Map<String, dynamic> action, Map<String, dynamic>? preview, String? localId, String? resultIdPath}) {
    final id = _uuid.v4();
    return enqueue(
      kind: kind,
      label: label,
      path: '/api/salon/act',
      body: {'organizationId': orgId, 'action': action, 'client_ref': id, '_preview': ?preview},
      localId: localId,
      resultIdPath: resultIdPath,
    );
  }

  /// Put local ids' server ids in; null when one is not known yet (what made it has not synced).
  Object? _resolve(Object? value) {
    if (value is String && value.startsWith('local_')) return store.serverId(value) ?? _Unresolved.instance;
    if (value is Map) {
      final out = <String, dynamic>{};
      for (final entry in value.entries) {
        if (entry.key.toString().startsWith('_')) continue; // shown on the phone only, never sent
        final resolved = _resolve(entry.value);
        if (resolved == _Unresolved.instance) return _Unresolved.instance;
        out[entry.key.toString()] = resolved;
      }
      return out;
    }
    if (value is List) {
      final out = [];
      for (final v in value) {
        final resolved = _resolve(v);
        if (resolved == _Unresolved.instance) return _Unresolved.instance;
        out.add(resolved);
      }
      return out;
    }
    return value;
  }

  Object? _at(Map<String, dynamic> data, String path) {
    Object? current = data;
    for (final part in path.split('.')) {
      if (current is! Map) return null;
      current = current[part];
    }
    return current;
  }

  Future<void>? _flushRun;

  /// The changes already tried in the send that is running (each is tried once per run).
  final Set<String> _tried = {};

  /// Send the outbox, oldest first. Stops at the first sign of no internet. A call while one is
  /// running waits for that one, and what was queued meanwhile is sent in that same run.
  Future<void> flush() {
    if (!signedIn) return Future.value();
    return _flushRun ??= _flush().whenComplete(() => _flushRun = null);
  }

  /// Can go now: not refused, not tried in this run, and not waiting on something that has not synced yet.
  bool _sendable(OutboxItem item) => item.state != OutboxState.failed && !_tried.contains(item.id) && _resolve(item.body) != _Unresolved.instance;
  bool get _hasSendable => store.outbox().any(_sendable);

  /// Counter actions carry a client reference, so the server does each once.
  static const _doneOnce = {'/api/salon/act'};

  /// Sending this again does no harm: the server does it once, or it only sets something (PATCH, PUT, DELETE).
  /// Anything else (a chat message, a new ticket) might be done twice, so after an unclear failure it waits for the person.
  static bool _safeToRepeat(OutboxItem item) => item.method != 'POST' || _doneOnce.contains(item.path);

  static const _notSure = 'Not sure it was sent. Check before you try again.';

  Future<void> _fail(OutboxItem item, String why) {
    item.state = OutboxState.failed;
    item.error = why;
    return store.putOutbox(item);
  }

  /// Changes kept from a sign-in the server ended are sent only for that same person; anyone else starts clean.
  Future<void> _claimOutbox() async {
    final owner = store.read('outbox_owner');
    if (owner == null) return;
    if ('${owner['userId'] ?? ''}' != '${me?['user']?['id'] ?? ''}') await store.clearOutbox();
    await store.remove('outbox_owner');
  }

  Future<void> _flush() async {
    final session = _session;
    syncing = true;
    notifyListeners();
    var sent = 0;
    _tried.clear();
    // Counter actions sent in this run stay in the outbox (laid over the lists) until the lists they change have been
    // fetched again, so an approved request, a new bill or a visit marked arrived never flips back for a moment.
    // Sending one again is safe: the server does each counter action once (client_ref).
    final settled = <OutboxItem>[];
    final days = <String>{};
    var bills = false;
    try {
      await _claimOutbox();
      var stopped = false;
      // Changes queued while this runs (a second chat message, Try again) go in this same run, not after the 30-second wait
      while (!stopped && session == _session && _hasSendable) {
        for (final item in store.outbox()) {
          if (!_sendable(item)) continue; // refused, or waits for what it depends on
          _tried.add(item.id);
          // A chat message tried before whose answer never came back may have reached the customer already: look first
          if (item.kind == 'message' && item.attempts > 0) {
            final saved = await _messageSaved(item);
            if (session != _session) return;
            if (saved == null) {
              stopped = true; // could not look (no internet): it waits for the next try
              break;
            }
            if (saved) {
              await store.removeOutbox(item.id);
              _reloadChat(item);
              sent++;
              continue;
            }
          }
          // Cut off while sending last time (the app was closed): it may have reached the server already
          if (item.state == OutboxState.sending && !_safeToRepeat(item)) {
            await _fail(item, _notSure);
            continue;
          }
          final body = _resolve(item.body);
          item.state = OutboxState.sending;
          item.attempts++;
          await store.putOutbox(item);
          notifyListeners();
          try {
            final result = await backend.send(item.method, item.path, Map<String, dynamic>.from(body as Map));
            if (session != _session) return; // signed out meanwhile
            final serverId = item.resultIdPath == null ? null : _at(result, item.resultIdPath!);
            if (item.localId != null && serverId != null) await store.mapId(item.localId!, serverId.toString());
            if (item.path == '/api/salon/act') {
              settled.add(item);
              final starts = DateTime.tryParse('${_at(result, 'appointment.starts_at') ?? ''}');
              if (starts != null) days.add(toIst(starts).toIso8601String().substring(0, 10));
              if (_at(result, 'invoice') != null) bills = true;
            } else {
              await store.removeOutbox(item.id);
            }
            sent++;
            _markOnline();
          } on SlowServerException {
            if (session != _session) return;
            // No answer in time, but the server may have done it: only what is safe to send again waits for the next try
            if (_safeToRepeat(item)) {
              item.state = OutboxState.waiting;
              await store.putOutbox(item);
            } else {
              await _fail(item, _notSure);
            }
            stopped = true;
            break;
          } on OfflineException {
            if (session != _session) return;
            item.state = OutboxState.waiting;
            await store.putOutbox(item);
            _markOffline();
            stopped = true;
            break;
          } on ApiException catch (e) {
            if (session != _session) return;
            // The sign-in ran out and could not be renewed just now: keep it waiting (it goes once the sign-in is renewed)
            if (e.status == 401) {
              item.state = OutboxState.waiting;
              item.attempts--;
              await store.putOutbox(item);
              stopped = true;
              break;
            }
            if (e.status == 402) {
              item.attempts--;
              await load('me', '/api/mobile/me', force: true);
              if (session != _session) return;
              // Paused workspace: keep it waiting (it is sent once a plan is chosen), and show the plan screen
              if (paused || !online) {
                item.state = OutboxState.waiting;
                item.error = e.message;
                await store.putOutbox(item);
                stopped = true;
                break;
              }
              // Only this is not in the plan: it stops with the server's words, and the rest carries on
              await _fail(item, e.message);
              continue;
            }
            // WhatsApp or Instagram refused a chat message: the server keeps it in the chat as not sent (with why), so it
            // is not kept here too (it would show twice, and each Try again would add another)
            if (item.kind == 'message' && e.status == 400 && await _messageSaved(item) == true) {
              if (session != _session) return;
              await store.removeOutbox(item.id);
              _reloadChat(item);
              continue;
            }
            // The server broke while doing it: it may be done already, so a chat message is not sent twice on its own
            if (e.status >= 500 && !_safeToRepeat(item)) {
              await _fail(item, _notSure);
              continue;
            }
            // Only a counter action's 409 means "still being saved, try again"; anywhere else it is final (say, that
            // number is already a contact), so it never holds up the changes behind it
            if (e.retryable && (e.status != 409 || _doneOnce.contains(item.path)) && item.attempts < 6) {
              item.state = OutboxState.waiting;
              item.error = e.message;
              await store.putOutbox(item);
              stopped = true;
              break;
            }
            await _fail(item, e.message);
          }
        }
      }
      if (settled.isNotEmpty && session == _session) await _settle(settled, days, bills);
    } finally {
      _tried.clear();
      syncing = false;
      notifyListeners();
    }
    if (sent > 0) {
      lastSync = DateTime.now();
      unawaited(refreshAll());
    }
  }

  /// After counter actions were sent: fetch again what they changed (today's visits and requests, the days they are
  /// on, the bills lists), then take them out of the outbox.
  Future<void> _settle(List<OutboxItem> settled, Set<String> days, bool bills) async {
    final today = istToday();
    await Future.wait([
      for (final day in {today, ...days})
        if (day == today || store.read(AppState.dayKey(day)) != null) load(AppState.dayKey(day), '/api/salon/appointments', query: {'date': day}, force: true),
      if (bills)
        for (final entry in {'invoices': const {'preset': 'week'}, ..._billLists}.entries) load(entry.key, '/api/salon/invoices', query: entry.value, force: true),
    ]);
    for (final item in settled) {
      await store.removeOutbox(item.id);
    }
  }

  /// Is this chat message already in the chat on the server (sent, or refused by WhatsApp)? Null when the server could
  /// not be reached to look. Matched by its words (or its file) among your messages since it was written.
  Future<bool?> _messageSaved(OutboxItem item) async {
    final conversationId = '${item.body['conversationId'] ?? ''}';
    if (conversationId.isEmpty) return false;
    final Map<String, dynamic> data;
    try {
      data = await backend.get('/api/messages', {if (orgId.isNotEmpty) 'organizationId': orgId, 'conversationId': conversationId, 'limit': '20'});
    } on SlowServerException {
      return null;
    } on OfflineException {
      _markOffline();
      return null;
    } on ApiException {
      return false;
    }
    final text = '${item.body['message'] ?? ''}'.trim();
    final media = '${item.body['mediaUrl'] ?? ''}';
    // A little room for the phone's clock being off from the server's (not more: the same words sent on purpose a
    // minute earlier must not count)
    final since = item.createdAt.subtract(const Duration(seconds: 10));
    for (final m in (data['messages'] as List? ?? const [])) {
      if (m is! Map || m['sender_type'] == 'contact') continue;
      final at = DateTime.tryParse('${m['created_at'] ?? ''}');
      if (at == null || at.isBefore(since)) continue;
      final body = '${m['body'] ?? ''}'.replaceFirst(RegExp(r'^\[reply:[^\]]*\]'), '').trim();
      if (text.isNotEmpty ? body == text : media.isNotEmpty && m['media_url'] == media) return true;
    }
    return false;
  }

  /// Fetch a chat's messages again when the phone keeps a copy (a message the server saved in its own way).
  void _reloadChat(OutboxItem item) {
    final conversationId = '${item.body['conversationId'] ?? ''}';
    final key = 'messages:$conversationId';
    if (conversationId.isEmpty || store.savedAt(key) == null) return;
    unawaited(load(key, '/api/messages', query: {'conversationId': conversationId, 'limit': '60'}, force: true));
  }

  Future<void> retry(OutboxItem item) async {
    // A chat message that may have gone already is looked for in the chat first (see _flush), so it is not sent twice
    item.attempts = item.kind == 'message' && item.error == _notSure ? 1 : 0;
    item.state = OutboxState.waiting;
    item.error = null;
    _tried.remove(item.id);
    await store.putOutbox(item);
    notifyListeners();
    await flush();
  }

  Future<void> discard(OutboxItem item) async {
    await store.removeOutbox(item.id);
    // Changes that were waiting on it can never be sent either
    if (item.localId != null) {
      for (final other in store.outbox()) {
        if (other.body.toString().contains(item.localId!)) await store.removeOutbox(other.id);
      }
    }
    notifyListeners();
  }
}

// ── Live: new messages and booking requests ──

extension LiveUpdates on AppState {
  /// Listen for new messages and chat changes for this workspace.
  void startLive() {
    if (orgId.isEmpty) return;
    backend.live(orgId, (table, change, row) => _onLive(table, change, row));
  }

  void _onLive(String table, String change, Map<String, dynamic> row) {
    if (table == 'messages') return _onMessage(change, row);
    if (table == 'conversations') return _onConversation(row);
  }

  void _onMessage(String change, Map<String, dynamic> row) {
    final convId = '${row['conversation_id'] ?? ''}';
    if (convId.isEmpty) return;
    // The chat's messages on the phone
    final key = 'messages:$convId';
    final saved = cached(key);
    if (saved != null) {
      final list = [for (final m in (saved['messages'] as List? ?? const [])) Map<String, dynamic>.from(m)];
      final at = list.indexWhere((m) => m['id'] == row['id']);
      if (at >= 0) {
        list[at] = {...list[at], ...row};
      } else if (change == 'INSERT') {
        list.add(row);
      }
      unawaited(store.write(key, {...saved, 'messages': list}));
    }
    if (change != 'INSERT') return changed();

    // The chat list: last message, unread count, newest first
    final fromCustomer = row['sender_type'] == 'contact';
    // The list (WhatsApp or Instagram) that has this chat
    String? listKey;
    var index = -1;
    var convs = <Map<String, dynamic>>[];
    Map<String, dynamic>? listData;
    for (final key in AppState.chatLists.values) {
      final data = cached(key);
      final list = [for (final c in (data?['conversations'] as List? ?? const [])) Map<String, dynamic>.from(c)];
      final at = list.indexWhere((c) => c['id'] == convId);
      if (at >= 0) {
        listKey = key;
        index = at;
        convs = list;
        listData = data;
        break;
      }
    }
    final instagram = listKey == AppState.chatLists['instagram'];
    if (listKey == null) {
      // A new chat: bring both lists up to date (it lands in the right one)
      unawaited(loadChats('whatsapp'));
      unawaited(loadChats('instagram'));
    } else {
      final conv = convs.removeAt(index);
      conv['last_message'] = {'body': row['body'], 'sender_type': row['sender_type'], 'created_at': row['created_at'], 'media_url': AppState._shortMedia(row['media_url'])};
      conv['last_message_at'] = row['created_at'];
      if (fromCustomer && openChatId != convId) conv['unread_count'] = ((conv['unread_count'] as num?) ?? 0) + 1;
      convs.insert(0, conv);
      unawaited(store.write(listKey, {...?listData, 'conversations': convs}));
    }
    changed();

    if (fromCustomer) {
      if (openChatId != convId) {
        final conv = index < 0 ? null : convs.first;
        final media = '${row['media_url'] ?? ''}'.isNotEmpty;
        final body = '${row['body'] ?? ''}'.trim();
        unawaited(
          Notifier.instance.notify(
            Notice(
              title: conv == null ? 'New message' : '${contactName(conv['contact'])}${instagram ? ' · Instagram' : ''}',
              body: body.isNotEmpty
                  ? body
                  : media
                  ? '📎 Photo or document'
                  : 'New message',
              chatId: convId,
            ),
          ),
        );
      }
      // A booking may have come in through the chat: look soon
      _bookingSoon?.cancel();
      _bookingSoon = Timer(const Duration(seconds: 4), checkBookings);
    }
  }

  void _onConversation(Map<String, dynamic> row) {
    for (final key in AppState.chatLists.values) {
      final listData = cached(key);
      if (listData == null) continue;
      final convs = [for (final c in (listData['conversations'] as List? ?? const [])) Map<String, dynamic>.from(c)];
      final index = convs.indexWhere((c) => c['id'] == row['id']);
      if (index < 0) continue;
      for (final field in ['unread_count', 'auto_reply_enabled', 'last_message_at', 'assigned_to']) {
        if (row.containsKey(field)) convs[index][field] = row[field];
      }
      if (openChatId == row['id']) convs[index]['unread_count'] = 0;
      unawaited(store.write(key, {...listData, 'conversations': convs}));
      changed();
      return;
    }
  }

  /// New booking requests (and bookings confirmed on their own) since last time: notify.
  /// Sends the reminders and feedback questions that are due. Quietly does nothing offline.
  Future<void> runDueJobs() async {
    if (!backend.signedIn || !online) return;
    // Scheduled campaigns start when someone looks: the server has no timer of its own yet
    // (app/api/campaigns/scheduled). Managers' phones nudge it every few minutes while the app is open.
    if (can('campaigns') && whatsappOn && DateTime.now().difference(_campaignsNudged).inMinutes >= 5) {
      _campaignsNudged = DateTime.now();
      try {
        await backend.get('/api/campaigns/scheduled', {'organizationId': orgId});
      } catch (_) {}
    }
    if (!frontDeskOn) return;
    try {
      await backend.send('POST', '/api/salon/tick', {'organizationId': orgId});
    } catch (_) {}
  }


  Future<void> checkBookings() async {
    if (!backend.signedIn || !frontDeskOn || !online) return;
    final key = AppState.dayKey(istToday());
    await load(key, '/api/salon/appointments', query: {'date': istToday()}, force: true);
    final day = cached(key);
    if (day == null) return;
    final requests = [for (final r in (day['requests'] as List? ?? const [])) Map<String, dynamic>.from(r)];
    final booked = [
      for (final a in (day['appointments'] as List? ?? const []))
        if (a['source'] == 'chat' || a['source'] == 'online') Map<String, dynamic>.from(a),
    ];
    final ids = {
      for (final r in [...requests, ...booked]) '${r['id']}',
    };
    final known = _knownBookings;
    _knownBookings = {...?known, ...ids};
    if (known == null) return; // the first look only remembers what is there
    // Pop-ups from the server announce every booking (shown at the top while the app is open), so nothing shows twice
    if (Push.instance.ready) return;
    for (final r in [...requests, ...booked]) {
      if (known.contains('${r['id']}')) continue;
      final services = ((r['services'] as List?) ?? const []).map((x) => x['name']).join(', ');
      final start = DateTime.tryParse('${r['starts_at']}');
      final when = start == null ? '' : '${formatDay(toIst(start))}, ${formatTime(r['starts_at'])}';
      final request = r['status'] == 'requested';
      unawaited(
        Notifier.instance.notify(Notice(title: request ? 'New booking request' : 'New booking', body: [r['customer_name'], services, when].where((x) => '$x'.isNotEmpty).join(' · '), bookings: true)),
      );
    }
  }
}

class _Unresolved {
  const _Unresolved._();
  static const instance = _Unresolved._();
}

/// When this phone last nudged the server to start due scheduled campaigns (see runDueJobs).
DateTime _campaignsNudged = DateTime.fromMillisecondsSinceEpoch(0);

/// The account was made, but signing in straight after failed: the person should sign in with email and password.
class AccountReadyException implements Exception {
  @override
  String toString() => 'Your account is ready. Please sign in with your email and password.';
}

/// Makes the app state reachable from any screen: AppScope.of(context).
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);

  static AppState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
  static AppState read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
