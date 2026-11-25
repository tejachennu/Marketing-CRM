import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'backend.dart';
import 'local_store.dart';
import 'notifier.dart';

/// Pop-up notifications when the app is closed or in the background (Firebase Cloud Messaging).
///
/// The server sends them (a customer wrote, a booking request, an order, a ticket assigned); the
/// phone shows them by itself. While the app is open, the banners at the top do the job, so nothing
/// is shown twice. The Firebase settings come from the server (`/api/mobile/config`), so none are
/// built into the app. Until they are set there, the app works as before.
class Push {
  Push._();
  static final instance = Push._();

  bool _started = false;
  String? _token;

  /// Why pop-ups do or do not reach this phone, in plain words (shown in More → Test notifications).
  String status = 'Checking…';

  /// The server can send pop-ups to this phone (registered, and Firebase fully set up on the server).
  bool get ready => _ready;
  bool _ready = false;
  StreamSubscription<String>? _refresh;
  StreamSubscription<RemoteMessage>? _opened;
  StreamSubscription<RemoteMessage>? _foreground;

  /// Start Firebase with the server's settings (`firebase` in /api/mobile/config). Used for
  /// notifications and for "Continue with Google". Returns false when they are not set up.
  static Future<bool> ensureFirebase(Map? config) async {
    if (kIsWeb || config == null) return false;
    final apiKey = '${config['apiKey'] ?? ''}', projectId = '${config['projectId'] ?? ''}', senderId = '${config['senderId'] ?? ''}';
    final appId = Platform.isIOS ? '${config['iosAppId'] ?? ''}' : '${config['appId'] ?? ''}';
    if (apiKey.isEmpty || projectId.isEmpty || senderId.isEmpty || appId.isEmpty) return false;
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(
        options: FirebaseOptions(apiKey: apiKey, appId: appId, messagingSenderId: senderId, projectId: projectId),
      );
    }
    return true;
  }

  /// Start once someone is signed in. [config] is the `firebase` part of the server's answer.
  Future<void> start(Backend backend, Map? config, {LocalStore? store}) async {
    if (kIsWeb || backend is! HttpBackend) return;
    // An address left from a sign-out without internet goes first, so this person gets a fresh one
    if (store != null) await dropOldAddress(store);
    if (config == null) {
      status = 'Pop-ups are not set up on the server yet.';
      return;
    }
    try {
      if (!_started) {
        if (!await ensureFirebase(config)) {
          status = 'Pop-ups are not set up on the server yet.';
          return;
        }
        final messaging = FirebaseMessaging.instance;
        final allowed = await messaging.requestPermission();
        if (allowed.authorizationStatus == AuthorizationStatus.denied) {
          status = 'Notifications are blocked for this app. Allow them in the phone\'s Settings → Apps → WAMA CRM → Notifications.';
        }
        // A notification was tapped: open what it is about
        _opened = FirebaseMessaging.onMessageOpenedApp.listen(_open);
        // With the app open, Android shows nothing for a push: show it as the banner at the top.
        // Chat messages already arrive through the live updates, so not those. Bookings show from here
        // (the app's own booking check stays quiet while pop-ups work, so nothing shows twice).
        _foreground = FirebaseMessaging.onMessage.listen((message) {
          final kind = '${message.data['kind'] ?? ''}';
          final open = '${message.data['open'] ?? ''}';
          final note = message.notification;
          if (note == null || (kind == 'message' && open.startsWith('chat:'))) return;
          Notifier.instance.notify(Notice(title: note.title ?? 'WAMA CRM', body: note.body ?? '', open: open));
        });
        // The app was closed and a notification opened it (the tap waits until the screens are ready)
        final first = await messaging.getInitialMessage();
        if (first != null) _open(first);
        // The server sends to the phone's FCM token (FCM HTTP v1 `token`), which these two give
        // ignore: deprecated_member_use
        _refresh = messaging.onTokenRefresh.listen((token) => unawaited(_register(backend, token)));
        _started = true;
      }
      // ignore: deprecated_member_use
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) {
        status = 'This phone could not get a notification address from Google. Check the internet and Google Play services.';
      } else {
        await _register(backend, token);
      }
    } catch (e) {
      status = 'Pop-ups could not start on this phone. Check the internet and Google Play services, then open the app again.';
      debugPrint('Push notifications are not available: $e');
    }
  }

  void _open(RemoteMessage message) {
    final open = '${message.data['open'] ?? ''}';
    if (open.isNotEmpty) Notifier.instance.tapped(open);
  }

  Future<void> _register(Backend backend, String token) async {
    if (!backend.signedIn) return;
    _token = token;
    try {
      final answer = await backend.send('POST', '/api/mobile/devices', {'token': token, 'platform': !kIsWeb && Platform.isIOS ? 'ios' : 'android'});
      // Only when the server says it can send pop-ups does the phone stop its own notifications (else nothing would come)
      _ready = answer['pushReady'] == true;
      Notifier.instance.pushOn = _ready;
      if (_ready) {
        if (!status.startsWith('Notifications are blocked')) status = 'On: pop-ups come even when the app is closed.';
      } else {
        status = answer['pushReady'] == false
            ? 'Pop-ups are not set up on the server yet (Firebase secret missing). The app still notifies you while it runs.'
            : 'This phone is registered. Tap Test notifications to check pop-ups reach it.';
      }
    } catch (e) {
      _ready = false;
      Notifier.instance.pushOn = false;
      status = 'This phone could not be registered for pop-ups. Check the internet, then open the app again.';
      debugPrint('This phone could not be registered for notifications: $e');
    }
  }

  /// Before signing out: this phone stops getting that person's notifications. When the server cannot be told
  /// (no internet), Google is asked to forget this phone's address instead, now or once the internet is back.
  Future<void> stop(Backend backend, LocalStore store) async {
    final token = _token;
    _token = null;
    if (token == null) return;
    try {
      await backend.send('DELETE', '/api/mobile/devices', {'token': token}).timeout(const Duration(seconds: 6));
      return;
    } catch (_) {}
    await store.write('push_drop', {'pending': true});
    unawaited(dropOldAddress(store));
  }

  Future<void>? _dropping;

  /// After a sign-out the server could not be told about, Google forgets this phone's notification address,
  /// so the old workspace's customer messages stop coming. Kept on the phone until it works.
  Future<void> dropOldAddress(LocalStore store) => _dropping ??= _dropOldAddress(store).whenComplete(() => _dropping = null);

  Future<void> _dropOldAddress(LocalStore store) async {
    if (store.read('push_drop')?['pending'] != true) return;
    try {
      if (!await ensureFirebase(store.read('config')?['firebase'] as Map?)) return;
      // The server sends to the FCM token (see getToken above), so that is what goes
      // ignore: deprecated_member_use
      await FirebaseMessaging.instance.deleteToken().timeout(const Duration(seconds: 10));
      await store.write('push_drop', {'pending': false});
    } catch (e) {
      debugPrint('The old notification address could not be dropped yet: $e');
    }
  }

  void dispose() {
    _refresh?.cancel();
    _opened?.cancel();
    _foreground?.cancel();
  }
}
