import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart' show Color;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Something to tell the person: a new WhatsApp message or a booking request.
class Notice {
  const Notice({required this.title, required this.body, this.chatId, this.bookings = false, this.open});
  final String title;
  final String body;

  /// Opens this chat when tapped.
  final String? chatId;

  /// Opens the Front Desk (booking requests) when tapped.
  final bool bookings;

  /// Anything else to open when tapped: 'tickets', 'orders', 'reviews', 'deals'.
  final String? open;
  String get payload => chatId != null
      ? 'chat:$chatId'
      : bookings
      ? 'bookings'
      : (open ?? '');
}

/// Notifications like WhatsApp: a banner at the top while the app is open, and a phone
/// notification (with sound) when it is in the background. When the app is fully closed, the
/// server's push messages do it (see push.dart).
class Notifier {
  Notifier._();
  static final instance = Notifier._();

  final _plugin = FlutterLocalNotificationsPlugin();
  final _notices = StreamController<Notice>.broadcast();
  final _taps = StreamController<String>.broadcast();
  bool _ready = false;
  int _id = 0;
  bool inForeground = true;

  /// Push notifications from the server are on: in the background the phone shows those, so no
  /// local one is added on top.
  bool pushOn = false;

  /// A push notification was tapped: open what it is about.
  void tapped(String payload) => _taps.add(payload);

  /// In-app banners (shown by the app shell).
  Stream<Notice> get notices => _notices.stream;

  /// A phone notification was tapped: its payload (`chat:<id>` or `bookings`).
  Stream<String> get taps => _taps.stream;

  Future<void> init() async {
    if (kIsWeb || _ready) return;
    try {
      await _plugin.initialize(
        settings: const InitializationSettings(android: AndroidInitializationSettings('ic_notification'), iOS: DarwinInitializationSettings()),
        onDidReceiveNotificationResponse: (response) {
          final payload = response.payload ?? '';
          if (payload.isNotEmpty) _taps.add(payload);
        },
      );
      final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await android?.requestNotificationsPermission();
      // The kinds of notification, so the phone's settings list them and push notifications land in the right one
      for (final (id, name) in const [
        ('messages', 'WhatsApp messages'),
        ('bookings', 'Booking requests'),
        ('orders', 'Orders'),
        ('tickets', 'Tickets'),
        ('deals', 'Sales Pipeline'),
        ('reviews', 'Reviews'),
      ]) {
        await android?.createNotificationChannel(AndroidNotificationChannel(id, name, importance: Importance.high));
      }
      _ready = true;
    } catch (e) {
      debugPrint('Notifications are not available: $e');
    }
  }

  Future<void> notify(Notice notice) async {
    if (inForeground || !_ready) {
      _notices.add(notice);
      return;
    }
    if (pushOn) return;
    final channel = notice.bookings ? ('bookings', 'Booking requests') : ('messages', 'WhatsApp messages');
    try {
      await _plugin.show(
        id: _id++ % 100000,
        title: notice.title,
        body: notice.body,
        payload: notice.payload,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(channel.$1, channel.$2, importance: Importance.high, priority: Priority.high, color: const Color(0xFF008069)),
          iOS: const DarwinNotificationDetails(presentAlert: true, presentSound: true),
        ),
      );
    } catch (e) {
      _notices.add(notice);
    }
  }
}
