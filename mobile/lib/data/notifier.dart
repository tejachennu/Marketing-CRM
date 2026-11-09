import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart' show Color;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Something to tell the person: a new WhatsApp message or a booking request.
class Notice {
  const Notice({required this.title, required this.body, this.chatId, this.bookings = false});
  final String title;
  final String body;

  /// Opens this chat when tapped.
  final String? chatId;

  /// Opens the Front Desk (booking requests) when tapped.
  final bool bookings;
  String get payload => chatId != null
      ? 'chat:$chatId'
      : bookings
      ? 'bookings'
      : '';
}

/// Notifications like WhatsApp: a banner at the top while the app is open, and a phone
/// notification (with sound) when it is in the background. When the app is fully closed, phone
/// notifications need push messages from the server (Firebase), which are not set up yet.
class Notifier {
  Notifier._();
  static final instance = Notifier._();

  final _plugin = FlutterLocalNotificationsPlugin();
  final _notices = StreamController<Notice>.broadcast();
  final _taps = StreamController<String>.broadcast();
  bool _ready = false;
  int _id = 0;
  bool inForeground = true;

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
      await _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.requestNotificationsPermission();
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
    final channel = notice.bookings ? ('bookings', 'Booking requests') : ('messages', 'WhatsApp messages');
    try {
      await _plugin.show(
        id: _id++ % 100000,
        title: notice.title,
        body: notice.body,
        payload: notice.payload,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(channel.$1, channel.$2, importance: Importance.high, priority: Priority.high, color: const Color(0xFF1D5BEA)),
          iOS: const DarwinNotificationDetails(presentAlert: true, presentSound: true),
        ),
      );
    } catch (e) {
      _notices.add(notice);
    }
  }
}
