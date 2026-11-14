import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'backend.dart';
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
  Future<void> start(Backend backend, Map? config) async {
    if (kIsWeb || backend is! HttpBackend || config == null) return;
    try {
      if (!_started) {
        if (!await ensureFirebase(config)) return;
        final messaging = FirebaseMessaging.instance;
        await messaging.requestPermission();
        // A notification was tapped: open what it is about
        _opened = FirebaseMessaging.onMessageOpenedApp.listen(_open);
        // With the app open, Android shows nothing for a push: show it as the banner at the top.
        // Messages and bookings already arrive through the live updates, so only the others.
        _foreground = FirebaseMessaging.onMessage.listen((message) {
          final kind = '${message.data['kind'] ?? ''}';
          final note = message.notification;
          if (note == null || kind == 'message' || kind == 'booking') return;
          Notifier.instance.notify(Notice(title: note.title ?? 'WAMA CRM', body: note.body ?? '', open: '${message.data['open'] ?? ''}'));
        });
        final first = await messaging.getInitialMessage();
        if (first != null) Timer(const Duration(milliseconds: 600), () => _open(first));
        // The server sends to the phone's FCM token (FCM HTTP v1 `token`), which these two give
        // ignore: deprecated_member_use
        _refresh = messaging.onTokenRefresh.listen((token) => unawaited(_register(backend, token)));
        _started = true;
        // From here the phone shows background notifications itself (no second, local one)
        Notifier.instance.pushOn = true;
      }
      // ignore: deprecated_member_use
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await _register(backend, token);
    } catch (e) {
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
      await backend.send('POST', '/api/mobile/devices', {'token': token, 'platform': !kIsWeb && Platform.isIOS ? 'ios' : 'android'});
    } catch (e) {
      debugPrint('This phone could not be registered for notifications: $e');
    }
  }

  /// Before signing out: this phone stops getting that person's notifications.
  Future<void> stop(Backend backend) async {
    final token = _token;
    _token = null;
    if (token == null) return;
    try {
      await backend.send('DELETE', '/api/mobile/devices', {'token': token}).timeout(const Duration(seconds: 6));
    } catch (_) {}
  }

  void dispose() {
    _refresh?.cancel();
    _opened?.cancel();
    _foreground?.cancel();
  }
}
