import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:uuid/uuid.dart';

import 'backend.dart';
import 'format.dart';
import 'local_store.dart';

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
  bool syncing = false;
  bool refreshing = false;
  DateTime? lastSync;
  String? lastError;
  Timer? _timer;
  Timer? _refreshTimer;
  StreamSubscription? _connectivity;

  // ── Start up ──

  Future<void> start() async {
    _connectivity = Connectivity().onConnectivityChanged.listen((results) {
      final hasNetwork = results.any((r) => r != ConnectivityResult.none);
      if (hasNetwork && !online) {
        online = true;
        notifyListeners();
        syncNow();
      } else if (!hasNetwork) {
        online = false;
        notifyListeners();
      }
    });
    // Every 30 seconds: send what is waiting, or check whether the internet is back.
    // Every 5 minutes: bring the lists up to date.
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (!backend.signedIn) return;
      if (waitingCount > 0) {
        unawaited(flush());
      } else if (!online) {
        unawaited(load('me', '/api/mobile/me', force: true));
      }
    });
    _refreshTimer = Timer.periodic(const Duration(minutes: 5), (_) {
      if (backend.signedIn && online) unawaited(refreshAll());
    });
    if (signedIn) unawaited(syncNow());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _refreshTimer?.cancel();
    _connectivity?.cancel();
    super.dispose();
  }

  bool get signedIn => backend.signedIn && me != null;

  Future<void> signIn(String email, String password) async {
    await backend.signIn(email, password);
    await load('me', '/api/mobile/me', force: true, rethrowErrors: true);
    await syncNow();
  }

  Future<void> signOut() async {
    await backend.signOut();
    await store.clear();
    notifyListeners();
  }

  // ── Who and where ──

  Map<String, dynamic>? get me => store.read('me');
  String get orgId => me?['organization']?['id']?.toString() ?? '';
  String get orgName => me?['organization']?['name']?.toString() ?? 'Workspace';
  bool can(String what) => me?['can']?[what] == true;
  bool get frontDeskOn => me?['connectors']?['frontDesk'] == true;

  // ── Lists kept on the phone ──

  Map<String, dynamic>? cached(String key) => store.read(key);
  DateTime? savedAt(String key) => store.savedAt(key);

  /// Fetch a list from the server into the phone. Offline: keep the copy already there.
  Future<void> load(String key, String path, {Map<String, String>? query, bool force = false, bool rethrowErrors = false}) async {
    if (!force && !online && store.read(key) != null) return;
    try {
      final data = await backend.get(path, {if (orgId.isNotEmpty) 'organizationId': orgId, ...?query});
      await store.write(key, data);
      _markOnline();
      notifyListeners();
    } on OfflineException {
      _markOffline();
      if (rethrowErrors) rethrow;
    } on ApiException catch (e) {
      lastError = e.message;
      notifyListeners();
      if (rethrowErrors) rethrow;
    }
  }

  static String dayKey(String date) => 'day:$date';

  Future<void>? _refreshRun;

  /// Bring every list up to date. A call while one is running waits for that one.
  Future<void> refreshAll() => _refreshRun ??= _refreshAll().whenComplete(() => _refreshRun = null);

  Future<void> _refreshAll() async {
    refreshing = true;
    notifyListeners();
    try {
      await load('me', '/api/mobile/me', force: true);
      if (!online) return;
      await Future.wait([
        if (frontDeskOn) ...[
          load('setup', '/api/salon/setup', force: true),
          load(dayKey(istToday()), '/api/salon/appointments', query: {'date': istToday()}, force: true),
          load('invoices', '/api/salon/invoices', query: {'preset': 'week'}, force: true),
        ],
        load('contacts', '/api/contacts', query: {'limit': '500', 'fields': 'basic'}, force: true),
        load('conversations', '/api/conversations', query: {'limit': '50'}, force: true),
        load('templates', '/api/whatsapp-templates', force: true),
        if (can('campaigns')) load('campaigns', '/api/campaigns', query: {'limit': '30'}, force: true),
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
    final conversations = (cached('conversations')?['conversations'] as List? ?? const []).take(10);
    final stale = conversations.where((c) {
      final saved = savedAt('messages:${c['id']}');
      final last = DateTime.tryParse('${c['last_message_at']}');
      return saved == null || (last != null && last.isAfter(saved));
    });
    await Future.wait([for (final c in stale) load('messages:${c['id']}', '/api/messages', query: {'conversationId': '${c['id']}', 'limit': '60'}, force: true)]);
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

  /// Send the outbox, oldest first. Stops at the first sign of no internet. A call while one is
  /// running waits for that one.
  Future<void> flush() {
    if (!backend.signedIn) return Future.value();
    return _flushRun ??= _flush().whenComplete(() => _flushRun = null);
  }

  Future<void> _flush() async {
    syncing = true;
    notifyListeners();
    var sent = 0;
    try {
      for (final item in store.outbox()) {
        if (item.state == OutboxState.failed) continue;
        final body = _resolve(item.body);
        if (body == _Unresolved.instance) continue; // waits for what it depends on
        item.state = OutboxState.sending;
        item.attempts++;
        await store.putOutbox(item);
        notifyListeners();
        try {
          final result = await backend.send(item.method, item.path, Map<String, dynamic>.from(body as Map));
          final serverId = item.resultIdPath == null ? null : _at(result, item.resultIdPath!);
          if (item.localId != null && serverId != null) await store.mapId(item.localId!, serverId.toString());
          await store.removeOutbox(item.id);
          sent++;
          _markOnline();
        } on OfflineException {
          item.state = OutboxState.waiting;
          await store.putOutbox(item);
          _markOffline();
          break;
        } on ApiException catch (e) {
          if (e.retryable && item.attempts < 6) {
            item.state = OutboxState.waiting;
            item.error = e.message;
            await store.putOutbox(item);
            break;
          }
          item.state = OutboxState.failed;
          item.error = e.message;
          await store.putOutbox(item);
        }
      }
    } finally {
      syncing = false;
      notifyListeners();
    }
    if (sent > 0) {
      lastSync = DateTime.now();
      unawaited(refreshAll());
    }
  }

  Future<void> retry(OutboxItem item) async {
    item.state = OutboxState.waiting;
    item.error = null;
    item.attempts = 0;
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

class _Unresolved {
  const _Unresolved._();
  static const instance = _Unresolved._();
}

/// Makes the app state reachable from any screen: AppScope.of(context).
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);

  static AppState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
  static AppState read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
