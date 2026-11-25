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

/// Notifications are always the phone's own pop-ups (with sound), also while the app is open; there
/// are no banners inside the app (owner: "that is not a pop-up, it is in-app: remove it"). In the
/// background, when the server's push messages work (see push.dart), those are the pop-ups and none
/// is added here, so nothing shows twice.
class Notifier {
  Notifier._();
  static final instance = Notifier._();

  final _plugin = FlutterLocalNotificationsPlugin();
  final _notices = StreamController<Notice>.broadcast();
  late final _taps = StreamController<String>.broadcast(onListen: _handOverTap);
  bool _ready = false;

  /// A tap that came before the app's screens were listening (the notification opened the app): handed to the first listener.
  String? _pendingTap;
  int _id = 0;
  bool inForeground = true;

  /// Push notifications from the server are on: in the background the phone shows those, so no
  /// local one is added on top.
  bool pushOn = false;

  /// A notification was tapped: open what it is about.
  void tapped(String payload) {
    if (payload.isEmpty) return;
    if (_taps.hasListener) {
      _taps.add(payload);
    } else {
      _pendingTap = payload;
    }
  }

  void _handOverTap() {
    final payload = _pendingTap;
    _pendingTap = null;
    if (payload != null) scheduleMicrotask(() => _taps.add(payload));
  }

  /// Every notice the app raised (shown as a phone notification; tests listen here).
  Stream<Notice> get notices => _notices.stream;

  /// A phone notification was tapped: its payload (`chat:<id>` or `bookings`).
  Stream<String> get taps => _taps.stream;

  Future<void> init() async {
    if (kIsWeb || _ready) return;
    try {
      await _plugin.initialize(
        settings: const InitializationSettings(android: AndroidInitializationSettings('ic_notification'), iOS: DarwinInitializationSettings()),
        onDidReceiveNotificationResponse: (response) => tapped(response.payload ?? ''),
      );
      // The app was closed and one of its own notifications opened it: open what it is about too
      final launch = await _plugin.getNotificationAppLaunchDetails();
      if (launch?.didNotificationLaunchApp == true) tapped(launch?.notificationResponse?.payload ?? '');
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
    _notices.add(notice);
    if (!_ready) return;
    // In the background the server's push pop-up is already on its way
    if (pushOn && !inForeground) return;
    final channel = switch (notice) {
      Notice(bookings: true) => ('bookings', 'Booking requests'),
      Notice(open: 'orders') => ('orders', 'Orders'),
      Notice(open: 'tickets') => ('tickets', 'Tickets'),
      Notice(open: 'deals') => ('deals', 'Sales Pipeline'),
      Notice(open: 'reviews') => ('reviews', 'Reviews'),
      _ => ('messages', 'WhatsApp messages'),
    };
    try {
      await _plugin.show(
        id: _id++ % 100000,
        title: notice.title,
        body: notice.body,
        payload: notice.payload,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(channel.$1, channel.$2, importance: Importance.high, priority: Priority.high, color: const Color(0xFF008069)),
          iOS: const DarwinNotificationDetails(presentAlert: true, presentBanner: true, presentList: true, presentSound: true),
        ),
      );
    } catch (e) {
      debugPrint('The notification could not be shown: $e');
    }
  }
}
