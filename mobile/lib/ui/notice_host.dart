import 'dart:async';

import 'package:flutter/material.dart';

import '../data/app_state.dart';
import '../data/notifier.dart';
import '../screens/chats/chat_screen.dart';
import '../screens/chats/tickets_screen.dart';
import '../screens/front_desk/front_desk_screen.dart';
import '../screens/front_desk/reviews_team.dart';
import '../screens/instagram/instagram_screen.dart';
import '../screens/store/store_screen.dart';

final navigatorKey = GlobalKey<NavigatorState>();

/// Opens what a notification is about: the chat, or the Front Desk with the booking requests.
void openNotice(AppState app, String payload, {bool waited = false}) {
  // Signed out (an old notification from before): nothing of it to open
  if (!app.signedIn) return;
  final nav = navigatorKey.currentState;
  if (nav == null) {
    // The notification opened the app and its screens are not up yet: open it once they are
    if (!waited) WidgetsBinding.instance.addPostFrameCallback((_) => openNotice(app, payload, waited: true));
    return;
  }
  if (payload.startsWith('chat:')) {
    final id = payload.substring(5);
    final conv = app.findChat(id);
    if (conv != null) {
      nav.push(MaterialPageRoute(builder: (_) => ChatScreen(conversation: Map<String, dynamic>.from(conv))));
    } else {
      // Not loaded yet (the app was just opened by the notification): bring the chats up to date, then open it
      unawaited(
        app.syncNow().then((_) {
          final fresh = app.findChat(id);
          if (fresh != null) navigatorKey.currentState?.push(MaterialPageRoute(builder: (_) => ChatScreen(conversation: Map<String, dynamic>.from(fresh))));
        }),
      );
    }
  } else if (payload == 'bookings') {
    nav.push(MaterialPageRoute(builder: (_) => const FrontDeskScreen(initialTab: 1)));
  } else if (payload == 'tickets') {
    nav.push(MaterialPageRoute(builder: (_) => const TicketsScreen()));
  } else if (payload == 'orders' && app.storeOn) {
    nav.push(MaterialPageRoute(builder: (_) => const StoreScreen()));
  } else if (payload == 'reviews' && app.frontDeskOn && app.can('manage')) {
    // Reviews is a managers' screen (low-review alerts go to staff too: they just open the app)
    nav.push(MaterialPageRoute(builder: (_) => const ReviewsScreen()));
  } else if (payload == 'instagram') {
    // A new comment on a post: the Comments tab
    nav.push(MaterialPageRoute(builder: (_) => const InstagramScreen(initialTab: 1)));
  }
  // 'deals' (a deal given to you): the Sales Pipeline is on the website only, so the tap just opens the app
}

/// Opens the right screen when a phone notification is tapped, and tells the notifier when the app
/// is in the background. Notifications are the phone's own pop-ups (notifier.dart); nothing is shown
/// inside the app.
class NoticeHost extends StatefulWidget {
  const NoticeHost({super.key, required this.app, required this.child});
  final AppState app;
  final Widget child;
  @override
  State<NoticeHost> createState() => _NoticeHostState();
}

class _NoticeHostState extends State<NoticeHost> with WidgetsBindingObserver {
  late final StreamSubscription<String> _taps;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _taps = Notifier.instance.taps.listen((payload) => openNotice(widget.app, payload));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    Notifier.instance.inForeground = state == AppLifecycleState.resumed;
    if (state == AppLifecycleState.resumed) unawaited(widget.app.syncNow());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _taps.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
