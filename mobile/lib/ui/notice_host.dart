import 'dart:async';

import 'package:flutter/material.dart';

import '../data/app_state.dart';
import '../data/notifier.dart';
import '../screens/chats/chat_screen.dart';
import '../screens/chats/tickets_screen.dart';
import '../screens/front_desk/front_desk_screen.dart';
import '../screens/front_desk/reviews_team.dart';
import '../screens/store/store_screen.dart';
import 'theme.dart';
import 'widgets.dart';

final navigatorKey = GlobalKey<NavigatorState>();

/// Opens what a notification is about: the chat, or the Front Desk with the booking requests.
void openNotice(AppState app, String payload) {
  final nav = navigatorKey.currentState;
  if (nav == null) return;
  if (payload.startsWith('chat:')) {
    final id = payload.substring(5);
    final list = (app.cached('conversations')?['conversations'] as List? ?? const []);
    final conv = list.cast<Map?>().firstWhere((c) => c!['id'] == id, orElse: () => null);
    if (conv != null) {
      nav.push(MaterialPageRoute(builder: (_) => ChatScreen(conversation: Map<String, dynamic>.from(conv))));
    } else {
      // Not loaded yet (the app was just opened by the notification): bring the chats up to date, then open it
      unawaited(
        app.syncNow().then((_) {
          final fresh = (app.cached('conversations')?['conversations'] as List? ?? const []).cast<Map?>().firstWhere((c) => c!['id'] == id, orElse: () => null);
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
  } else if (payload == 'reviews' && app.frontDeskOn) {
    nav.push(MaterialPageRoute(builder: (_) => const ReviewsScreen()));
  }
}

/// Shows notices as a banner at the top (like WhatsApp while it is open), opens the right screen
/// when a banner or a phone notification is tapped, and tells the notifier when the app is in the
/// background (then notices go to the phone's notifications instead).
class NoticeHost extends StatefulWidget {
  const NoticeHost({super.key, required this.app, required this.child});
  final AppState app;
  final Widget child;
  @override
  State<NoticeHost> createState() => _NoticeHostState();
}

class _NoticeHostState extends State<NoticeHost> with WidgetsBindingObserver {
  Notice? _notice;
  Timer? _hide;
  late final StreamSubscription<Notice> _notices;
  late final StreamSubscription<String> _taps;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _notices = Notifier.instance.notices.listen((notice) {
      _hide?.cancel();
      setState(() => _notice = notice);
      _hide = Timer(const Duration(seconds: 5), () => mounted ? setState(() => _notice = null) : null);
    });
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
    _notices.cancel();
    _taps.cancel();
    _hide?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final notice = _notice;
    return Stack(
      children: [
        widget.child,
        Positioned(
          left: 10,
          right: 10,
          top: 0,
          child: SafeArea(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 220),
              transitionBuilder: (child, animation) => SlideTransition(
                position: Tween(begin: const Offset(0, -1.2), end: Offset.zero).animate(animation),
                child: child,
              ),
              child: notice == null
                  ? const SizedBox.shrink()
                  : Material(
                      key: ValueKey(notice),
                      elevation: 6,
                      color: Colors.white,
                      shadowColor: Colors.black26,
                      borderRadius: BorderRadius.circular(16),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(16),
                        onTap: () {
                          setState(() => _notice = null);
                          openNotice(widget.app, notice.payload);
                        },
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
                          child: Row(
                            children: [
                              notice.bookings || notice.open != null
                                  ? Container(
                                      width: 40,
                                      height: 40,
                                      decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(12)),
                                      child: Icon(switch (notice.open) {
                                        'tickets' => Icons.confirmation_number_outlined,
                                        'orders' => Icons.shopping_bag_outlined,
                                        'reviews' => Icons.star_outline_rounded,
                                        'deals' => Icons.trending_up,
                                        _ => Icons.event_available,
                                      }, color: Brand.blue),
                                    )
                                  : Avatar(notice.title, size: 40),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      notice.title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                                    ),
                                    Text(
                                      notice.body,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(color: Brand.textSoft, fontSize: 13.5),
                                    ),
                                  ],
                                ),
                              ),
                              IconButton(
                                visualDensity: VisualDensity.compact,
                                onPressed: () => setState(() => _notice = null),
                                icon: const Icon(Icons.close, size: 18, color: Brand.faint),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
            ),
          ),
        ),
      ],
    );
  }
}
