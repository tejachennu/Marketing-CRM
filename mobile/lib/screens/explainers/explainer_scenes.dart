import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import 'explainer_content.dart';

/// The moving pictures of the explainer videos. Each scene is drawn on a fixed 360 × 420 canvas (the player scales it
/// to the screen) from [t], how far the scene has played (0 → 1). Flat WhatsApp colours, no gradients.
const sceneSize = Size(360, 420);

/// 0 → 1 between [a] and [b] of the scene, eased.
double phase(double t, double a, double b, [Curve curve = Curves.easeOutCubic]) => curve.transform(((t - a) / (b - a)).clamp(0.0, 1.0));

/// Fades and lifts [child] in as [p] goes 0 → 1.
Widget rise(double p, Widget child, {double dy = 18, double fromScale = 0.96}) => Opacity(
  opacity: p.clamp(0.0, 1.0),
  child: Transform.translate(
    offset: Offset(0, (1 - p) * dy),
    child: Transform.scale(scale: fromScale + (1 - fromScale) * p, child: child),
  ),
);

/// Pops [child] in with a little overshoot.
Widget pop(double p, Widget child) => Opacity(
  opacity: (p * 2).clamp(0.0, 1.0),
  child: Transform.scale(scale: Curves.easeOutBack.transform(p.clamp(0.0, 1.0)), child: child),
);

class SceneView extends StatelessWidget {
  const SceneView({super.key, required this.scene, required this.t, required this.lang});
  final Scene scene;
  final double t;
  final String lang;

  @override
  Widget build(BuildContext context) {
    final child = switch (scene.kind) {
      SceneKind.picture => _PictureScene(scene: scene, t: t, lang: lang),
      SceneKind.flow => _FlowScene(scene: scene, t: t, lang: lang),
      SceneKind.chat => _ChatScene(scene: scene, t: t, lang: lang),
      SceneKind.languages => _ChatScene(scene: scene, t: t, lang: lang, languages: true),
      SceneKind.inbox => _InboxScene(scene: scene, t: t, lang: lang),
      SceneKind.alerts => _AlertsScene(scene: scene, t: t, lang: lang),
      SceneKind.ad => _AdScene(scene: scene, t: t, lang: lang),
      SceneKind.growth => _GrowthScene(scene: scene, t: t, lang: lang),
      SceneKind.end => _EndScene(t: t),
    };
    // A scene is a picture scaled to the screen as a whole: the phone's text size must not grow the words inside it
    // (the captions under the video do follow it)
    return MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: TextScaler.noScaling),
      child: SizedBox.fromSize(size: sceneSize, child: child),
    );
  }
}

// ── Shared pieces ──

const _chatBg = Color(0xFFEFEAE2);
const _soft = Color(0xFFF1FBEE);
const _dark = Color(0xFF0B3B33);

BoxDecoration _card([double r = 16]) => BoxDecoration(
  color: Colors.white,
  borderRadius: BorderRadius.circular(r),
  boxShadow: const [BoxShadow(color: Color(0x1A0B141A), blurRadius: 14, offset: Offset(0, 5))],
);

/// A phone: dark frame, rounded screen, [child] inside.
class _Phone extends StatelessWidget {
  const _Phone({required this.child, this.screen = _chatBg});
  final Widget child;
  final Color screen;
  static const width = 236.0;
  static const height = 404.0;
  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: height,
    padding: const EdgeInsets.all(7),
    decoration: BoxDecoration(
      color: const Color(0xFF111B21),
      borderRadius: BorderRadius.circular(34),
      boxShadow: const [BoxShadow(color: Color(0x330B141A), blurRadius: 22, offset: Offset(0, 10))],
    ),
    child: ClipRRect(
      borderRadius: BorderRadius.circular(28),
      child: ColoredBox(color: screen, child: child),
    ),
  );
}

/// WhatsApp's green chat header: the shop, "online" (or the time at night).
class _ChatHeader extends StatelessWidget {
  const _ChatHeader({required this.lang, this.clock});
  final String lang;
  final String? clock;
  @override
  Widget build(BuildContext context) => Container(
    color: Brand.blue,
    padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
    child: Row(
      children: [
        const Icon(Icons.arrow_back, color: Colors.white, size: 16),
        const SizedBox(width: 6),
        Container(
          width: 30,
          height: 30,
          decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
          padding: const EdgeInsets.all(3),
          child: ClipOval(child: Image.asset('assets/app_icon.png', errorBuilder: (_, _, _) => const SizedBox())),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                VideoWords.yourShop.of(lang),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700),
              ),
              Text(VideoWords.online.of(lang), maxLines: 1, style: const TextStyle(color: Color(0xCCFFFFFF), fontSize: 10.5)),
            ],
          ),
        ),
        if (clock != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
            decoration: BoxDecoration(color: const Color(0x33FFFFFF), borderRadius: BorderRadius.circular(99)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.nightlight_round, color: Colors.white, size: 11),
                const SizedBox(width: 3),
                Text(
                  clock!,
                  style: const TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w700),
                ),
              ],
            ),
          )
        else
          const Icon(Icons.call_outlined, color: Colors.white, size: 16),
      ],
    ),
  );
}

/// "· · ·" while the reply is being written.
class _Typing extends StatelessWidget {
  const _Typing({required this.t});
  final double t;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(color: Brand.bubble, borderRadius: BorderRadius.circular(14)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < 3; i++)
          Container(
            width: 6,
            height: 6,
            margin: const EdgeInsets.symmetric(horizontal: 2),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Brand.blue.withValues(alpha: 0.35 + 0.65 * (0.5 + 0.5 * math.sin(t * 40 - i * 1.2)).clamp(0.0, 1.0)),
            ),
          ),
      ],
    ),
  );
}

class _BubbleView extends StatelessWidget {
  const _BubbleView({required this.bubble, required this.lang});
  final Bubble bubble;
  final String lang;
  @override
  Widget build(BuildContext context) {
    final b = bubble;
    if (b.card) {
      return Container(
        constraints: const BoxConstraints(maxWidth: 190),
        padding: const EdgeInsets.fromLTRB(10, 9, 12, 9),
        decoration: _card(12),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 26,
              height: 26,
              decoration: const BoxDecoration(color: Brand.green, shape: BoxShape.circle),
              child: const Icon(Icons.check, color: Colors.white, size: 16),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                b.text.of(lang),
                style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Brand.text, height: 1.25),
              ),
            ),
          ],
        ),
      );
    }
    return Column(
      crossAxisAlignment: b.me ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          constraints: const BoxConstraints(maxWidth: 178),
          padding: const EdgeInsets.fromLTRB(10, 7, 10, 7),
          decoration: BoxDecoration(
            color: b.me ? Brand.bubble : Colors.white,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(12),
              topRight: const Radius.circular(12),
              bottomLeft: Radius.circular(b.me ? 12 : 3),
              bottomRight: Radius.circular(b.me ? 3 : 12),
            ),
            boxShadow: const [BoxShadow(color: Color(0x140B141A), blurRadius: 2, offset: Offset(0, 1))],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (b.ai)
                Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.auto_awesome, size: 10, color: Brand.blue),
                      const SizedBox(width: 3),
                      Text(
                        VideoWords.aiReply.of(lang),
                        style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: Brand.blue),
                      ),
                    ],
                  ),
                ),
              Text(b.text.of(lang), style: const TextStyle(fontSize: 12, color: Brand.text, height: 1.3)),
            ],
          ),
        ),
        if (b.button != null)
          Container(
            margin: const EdgeInsets.only(top: 4),
            width: 178,
            padding: const EdgeInsets.symmetric(vertical: 7),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.reply, size: 13, color: Brand.blue),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    b.button!.of(lang),
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Brand.blue),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

// ── Scenes ──

class _ChatScene extends StatelessWidget {
  const _ChatScene({required this.scene, required this.t, required this.lang, this.languages = false});
  final Scene scene;
  final double t;
  final String lang;
  final bool languages;

  @override
  Widget build(BuildContext context) {
    final n = scene.chat.length;
    final step = 0.74 / math.max(n, 1);
    final rows = <Widget>[];
    for (var i = 0; i < n; i++) {
      final b = scene.chat[i];
      final at = 0.08 + i * step;
      final p = phase(t, at, at + 0.1);
      // The business "types" for a moment before each reply
      final typing = b.me && !b.card && t > at - step * 0.55 && t < at;
      if (typing) {
        rows.add(
          Align(
            alignment: Alignment.centerRight,
            child: _Typing(t: t),
          ),
        );
      } else if (p > 0) {
        rows.add(
          Align(
            alignment: b.card ? Alignment.center : (b.me ? Alignment.centerRight : Alignment.centerLeft),
            child: rise(p, _BubbleView(bubble: b, lang: lang), dy: 14),
          ),
        );
      }
      rows.add(const SizedBox(height: 7));
    }
    final chips = ['English', 'తెలుగు', 'हिंदी', 'Tenglish', 'Hinglish'];
    final spots = const [Offset(4, 40), Offset(288, 70), Offset(0, 300), Offset(282, 250), Offset(270, 360)];
    return Stack(
      children: [
        Positioned.fill(
          child: Container(
            decoration: BoxDecoration(color: _soft, borderRadius: BorderRadius.circular(28)),
          ),
        ),
        Center(
          child: _Phone(
            child: Column(
              children: [
                _ChatHeader(lang: lang, clock: scene.clock),
                // Newest at the bottom; older messages slide up out of sight, as in a real chat
                Expanded(
                  child: ClipRect(
                    child: LayoutBuilder(
                      builder: (context, box) => SingleChildScrollView(
                        reverse: true,
                        physics: const NeverScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(9, 10, 9, 8),
                        child: ConstrainedBox(
                          constraints: BoxConstraints(minHeight: math.max(0, box.maxHeight - 18)),
                          child: Column(mainAxisAlignment: MainAxisAlignment.end, children: rows),
                        ),
                      ),
                    ),
                  ),
                ),
                Container(
                  margin: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(99)),
                  child: const Row(
                    children: [
                      Icon(Icons.emoji_emotions_outlined, size: 15, color: Brand.faint),
                      Spacer(),
                      Icon(Icons.mic, size: 15, color: Brand.blue),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        if (languages)
          for (var i = 0; i < chips.length; i++)
            Positioned(
              left: spots[i].dx,
              top: spots[i].dy,
              child: pop(
                phase(t, 0.1 + i * 0.12, 0.26 + i * 0.12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: i.isEven ? Brand.blue : Colors.white,
                    borderRadius: BorderRadius.circular(99),
                    boxShadow: const [BoxShadow(color: Color(0x1A0B141A), blurRadius: 8, offset: Offset(0, 3))],
                  ),
                  child: Text(
                    chips[i],
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: i.isEven ? Colors.white : Brand.blue),
                  ),
                ),
              ),
            ),
      ],
    );
  }
}

class _PictureScene extends StatelessWidget {
  const _PictureScene({required this.scene, required this.t, required this.lang});
  final Scene scene;
  final double t;
  final String lang;
  @override
  Widget build(BuildContext context) {
    // Slow push-in, like a camera move
    final zoom = 1.0 + 0.1 * Curves.easeInOut.transform(t);
    final spots = const [Alignment(-0.92, -0.78), Alignment(0.95, -0.15), Alignment(-0.75, 0.86)];
    return Stack(
      children: [
        Positioned.fill(
          child: Container(
            decoration: BoxDecoration(color: _soft, borderRadius: BorderRadius.circular(28)),
          ),
        ),
        Positioned.fill(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(28),
            child: Transform.scale(
              scale: zoom,
              alignment: const Alignment(0.1, 0.2),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: rise(
                  phase(t, 0, 0.18),
                  Image.asset('assets/images/${scene.picture ?? 'welcome'}.png', fit: BoxFit.contain, errorBuilder: (_, _, _) => const SizedBox()),
                  dy: 10,
                  fromScale: 0.9,
                ),
              ),
            ),
          ),
        ),
        for (var i = 0; i < scene.items.length && i < spots.length; i++)
          Align(
            alignment: spots[i],
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: pop(
                phase(t, 0.22 + i * 0.17, 0.36 + i * 0.17),
                Container(
                  padding: const EdgeInsets.fromLTRB(8, 7, 12, 7),
                  decoration: _card(99),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 26,
                        height: 26,
                        decoration: const BoxDecoration(color: Brand.blue, shape: BoxShape.circle),
                        child: Icon(scene.items[i].icon, size: 15, color: Colors.white),
                      ),
                      const SizedBox(width: 7),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 150),
                        child: Text(
                          scene.items[i].label.of(lang),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.text),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Steps joined by a line that draws itself: Ad → Chat → AI reply → Booking → Bill → Review.
class _FlowScene extends StatelessWidget {
  const _FlowScene({required this.scene, required this.t, required this.lang});
  final Scene scene;
  final double t;
  final String lang;
  @override
  Widget build(BuildContext context) {
    final n = scene.items.length;
    final gap = (sceneSize.height - 40) / math.max(n, 1);
    final line = phase(t, 0.05, 0.85, Curves.easeInOut);
    return Stack(
      children: [
        Positioned.fill(
          child: Container(
            decoration: BoxDecoration(color: _soft, borderRadius: BorderRadius.circular(28)),
          ),
        ),
        // The line down the middle, growing
        Positioned(
          left: sceneSize.width / 2 - 2,
          top: 20 + gap / 2,
          child: Container(
            width: 4,
            height: (gap * (n - 1)) * line,
            decoration: BoxDecoration(color: Brand.blue, borderRadius: BorderRadius.circular(2)),
          ),
        ),
        for (var i = 0; i < n; i++)
          Positioned(
            left: 0,
            right: 0,
            top: 20 + i * gap,
            height: gap,
            child: Builder(
              builder: (context) {
                final p = phase(t, 0.05 + i * (0.75 / n), 0.2 + i * (0.75 / n));
                final left = i.isEven;
                final label = Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: _card(14),
                  child: Text(
                    scene.items[i].label.of(lang),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.text),
                  ),
                );
                return Row(
                  children: [
                    Expanded(
                      child: Align(
                        alignment: Alignment.centerRight,
                        child: left ? Padding(padding: const EdgeInsets.only(right: 14), child: rise(p, label, dy: 0)) : const SizedBox(),
                      ),
                    ),
                    pop(
                      p,
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: i == n - 1 ? Brand.green : Brand.blue,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 3),
                          boxShadow: const [BoxShadow(color: Color(0x260B141A), blurRadius: 8, offset: Offset(0, 3))],
                        ),
                        child: Icon(scene.items[i].icon, color: Colors.white, size: 21),
                      ),
                    ),
                    Expanded(
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: !left ? Padding(padding: const EdgeInsets.only(left: 14), child: rise(p, label, dy: 0)) : const SizedBox(),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
      ],
    );
  }
}

/// A chat list: rows slide in; numbers are unread counts, names are who the chat is given to.
class _InboxScene extends StatelessWidget {
  const _InboxScene({required this.scene, required this.t, required this.lang});
  final Scene scene;
  final double t;
  final String lang;
  @override
  Widget build(BuildContext context) {
    final tones = const [Color(0xFFDCF3E6), Color(0xFFE7E3F7), Color(0xFFFDEBD8), Color(0xFFDDEBFA)];
    final inks = const [Color(0xFF1B7A4B), Color(0xFF5B4BA8), Color(0xFFA2561A), Color(0xFF2C63A8)];
    return Stack(
      children: [
        Positioned.fill(
          child: Container(
            decoration: BoxDecoration(color: _soft, borderRadius: BorderRadius.circular(28)),
          ),
        ),
        Center(
          child: _Phone(
            screen: Colors.white,
            child: SingleChildScrollView(
              physics: const NeverScrollableScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
                    child: Row(
                      children: [
                        Text(
                          VideoWords.chats.of(lang),
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.text),
                        ),
                        const Spacer(),
                        const Icon(Icons.search, size: 18, color: Brand.textSoft),
                      ],
                    ),
                  ),
                  for (var i = 0; i < scene.items.length; i++)
                    Builder(
                      builder: (context) {
                        final it = scene.items[i];
                        final p = phase(t, 0.06 + i * 0.12, 0.22 + i * 0.12);
                        final tag = it.tag?.of(lang);
                        final unread = tag != null && RegExp(r'^\d+$').hasMatch(tag);
                        final tagP = phase(t, 0.45 + i * 0.1, 0.6 + i * 0.1);
                        final name = it.label.of(lang);
                        return Opacity(
                          opacity: p,
                          child: Transform.translate(
                            offset: Offset((1 - p) * 40, 0),
                            child: Container(
                              padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
                              decoration: const BoxDecoration(
                                border: Border(bottom: BorderSide(color: Brand.lineSoft)),
                              ),
                              child: Row(
                                children: [
                                  CircleAvatar(
                                    radius: 17,
                                    backgroundColor: tones[i % tones.length],
                                    child: Text(
                                      name.characters.first,
                                      style: TextStyle(color: inks[i % inks.length], fontWeight: FontWeight.w700, fontSize: 14),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          name,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.text),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          it.sub?.of(lang) ?? '',
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(fontSize: 11, color: Brand.muted),
                                        ),
                                      ],
                                    ),
                                  ),
                                  if (tag != null) ...[
                                    const SizedBox(width: 6),
                                    pop(
                                      unread ? p : tagP,
                                      unread
                                          ? Container(
                                              width: 20,
                                              height: 20,
                                              alignment: Alignment.center,
                                              decoration: const BoxDecoration(color: Brand.green, shape: BoxShape.circle),
                                              child: Text(
                                                tag,
                                                style: const TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w700),
                                              ),
                                            )
                                          : Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                                              decoration: BoxDecoration(
                                                color: Brand.bubble,
                                                borderRadius: BorderRadius.circular(99),
                                                border: Border.all(color: Brand.blue),
                                              ),
                                              child: Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  const Icon(Icons.person, size: 11, color: Brand.blue),
                                                  const SizedBox(width: 2),
                                                  Text(
                                                    tag,
                                                    style: const TextStyle(color: Color(0xFF15603E), fontSize: 10, fontWeight: FontWeight.w700),
                                                  ),
                                                ],
                                              ),
                                            ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Notifications dropping onto a phone's lock screen, one after another.
class _AlertsScene extends StatelessWidget {
  const _AlertsScene({required this.scene, required this.t, required this.lang});
  final Scene scene;
  final double t;
  final String lang;
  @override
  Widget build(BuildContext context) {
    final n = scene.items.length;
    return Stack(
      children: [
        Positioned.fill(
          child: Container(
            decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(28)),
          ),
        ),
        Center(
          child: _Phone(
            screen: _dark,
            child: Stack(
              children: [
                // Quiet circles on the wallpaper
                Positioned(
                  right: -40,
                  top: 60,
                  child: Container(
                    width: 150,
                    height: 150,
                    decoration: const BoxDecoration(color: Color(0xFF0F4A40), shape: BoxShape.circle),
                  ),
                ),
                Positioned(
                  left: -50,
                  bottom: -30,
                  child: Container(
                    width: 170,
                    height: 170,
                    decoration: const BoxDecoration(color: Color(0xFF0F4A40), shape: BoxShape.circle),
                  ),
                ),
                SingleChildScrollView(
                  physics: const NeverScrollableScrollPhysics(),
                  child: Column(
                    children: [
                      const SizedBox(height: 22),
                      const Text(
                        '9:41',
                        style: TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w300, letterSpacing: 1),
                      ),
                      const SizedBox(height: 14),
                      for (var i = 0; i < n; i++)
                        Builder(
                          builder: (context) {
                            final p = phase(t, 0.08 + i * (0.6 / n), 0.24 + i * (0.6 / n), Curves.easeOutBack);
                            final it = scene.items[i];
                            return Opacity(
                              opacity: p.clamp(0.0, 1.0),
                              child: Transform.translate(
                                offset: Offset(0, (1 - p) * -30),
                                child: Container(
                                  margin: const EdgeInsets.fromLTRB(10, 0, 10, 8),
                                  padding: const EdgeInsets.all(9),
                                  decoration: BoxDecoration(color: const Color(0xF2FFFFFF), borderRadius: BorderRadius.circular(16)),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Container(
                                        width: 28,
                                        height: 28,
                                        decoration: BoxDecoration(color: Brand.blue, borderRadius: BorderRadius.circular(8)),
                                        child: Icon(it.icon, color: Colors.white, size: 16),
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              it.label.of(lang),
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Brand.text, height: 1.25),
                                            ),
                                            if (it.sub != null)
                                              Text(
                                                it.sub!.of(lang),
                                                maxLines: 2,
                                                overflow: TextOverflow.ellipsis,
                                                style: const TextStyle(fontSize: 10.5, color: Brand.muted, height: 1.25),
                                              ),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// A sponsored post with an offer; its "Send message" button gets tapped and opens WhatsApp.
class _AdScene extends StatelessWidget {
  const _AdScene({required this.scene, required this.t, required this.lang});
  final Scene scene;
  final double t;
  final String lang;
  @override
  Widget build(BuildContext context) {
    final offer = scene.items.isNotEmpty ? scene.items[0] : null;
    final button = scene.items.length > 1 ? scene.items[1] : null;
    final tap = phase(t, 0.62, 0.78);
    final pressed = t > 0.66 && t < 0.8;
    final hearts = [for (var i = 0; i < 5; i++) phase(t, 0.2 + i * 0.07, 0.5 + i * 0.07)];
    return Stack(
      children: [
        Positioned.fill(
          child: Container(
            decoration: BoxDecoration(color: _soft, borderRadius: BorderRadius.circular(28)),
          ),
        ),
        Center(
          child: rise(
            phase(t, 0, 0.16),
            Container(
              width: 272,
              decoration: _card(18),
              clipBehavior: Clip.antiAlias,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
                    child: Row(
                      children: [
                        Container(
                          width: 30,
                          height: 30,
                          padding: const EdgeInsets.all(2),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: Brand.blue, width: 1.5),
                          ),
                          child: ClipOval(child: Image.asset('assets/app_icon.png', errorBuilder: (_, _, _) => const SizedBox())),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            offer?.sub?.of(lang) ?? '',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Brand.text),
                          ),
                        ),
                        const Icon(Icons.more_horiz, size: 18, color: Brand.textSoft),
                      ],
                    ),
                  ),
                  // The offer picture
                  Container(
                    height: 176,
                    color: Brand.blue,
                    child: Stack(
                      children: [
                        Positioned(
                          right: -30,
                          top: -30,
                          child: Container(
                            width: 140,
                            height: 140,
                            decoration: const BoxDecoration(color: Color(0xFF0A8F76), shape: BoxShape.circle),
                          ),
                        ),
                        Positioned(
                          left: -20,
                          bottom: -40,
                          child: Container(
                            width: 120,
                            height: 120,
                            decoration: const BoxDecoration(color: Color(0xFF00735E), shape: BoxShape.circle),
                          ),
                        ),
                        Center(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.auto_awesome, color: Brand.green, size: 26),
                                const SizedBox(height: 6),
                                Text(
                                  offer?.label.of(lang) ?? '',
                                  textAlign: TextAlign.center,
                                  maxLines: 3,
                                  style: const TextStyle(color: Colors.white, fontSize: 21, fontWeight: FontWeight.w700, height: 1.2),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
                    child: Row(
                      children: [
                        for (var i = 0; i < hearts.length; i++)
                          Padding(
                            padding: const EdgeInsets.only(right: 2),
                            child: pop(hearts[i], const Icon(Icons.favorite, size: 17, color: Brand.blue)),
                          ),
                        const Spacer(),
                        const Icon(Icons.chat_bubble_outline, size: 17, color: Brand.textSoft),
                        const SizedBox(width: 10),
                        const Icon(Icons.send_outlined, size: 17, color: Brand.textSoft),
                      ],
                    ),
                  ),
                  // Send message (WhatsApp)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
                    child: AnimatedScale(
                      scale: pressed ? 0.95 : 1,
                      duration: const Duration(milliseconds: 120),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(color: pressed ? const Color(0xFF1EB257) : Brand.green, borderRadius: BorderRadius.circular(10)),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.chat, size: 16, color: Colors.white),
                            const SizedBox(width: 6),
                            Text(
                              button?.label.of(lang) ?? '',
                              style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        // A finger taps the button
        if (tap > 0)
          Positioned(
            left: 180 - 12 * tap,
            top: 352 + 30 * (1 - tap),
            child: Opacity(
              opacity: (1 - phase(t, 0.86, 0.95)).clamp(0.0, 1.0) * tap,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  if (pressed)
                    Container(
                      width: 46,
                      height: 46,
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.45), shape: BoxShape.circle),
                    ),
                  const Icon(Icons.touch_app, size: 36, color: Brand.text),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// Bars that grow, and what our team makes each month.
class _GrowthScene extends StatelessWidget {
  const _GrowthScene({required this.scene, required this.t, required this.lang});
  final Scene scene;
  final double t;
  final String lang;
  @override
  Widget build(BuildContext context) {
    const bars = [0.28, 0.36, 0.33, 0.5, 0.58, 0.72, 0.9];
    return Stack(
      children: [
        Positioned.fill(
          child: Container(
            decoration: BoxDecoration(color: _soft, borderRadius: BorderRadius.circular(28)),
          ),
        ),
        Positioned(
          left: 28,
          right: 28,
          top: 26,
          child: rise(
            phase(t, 0, 0.15),
            Container(
              height: 210,
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
              decoration: _card(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.forum_outlined, size: 18, color: Brand.blue),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          scene.items.length > 2 ? scene.items[2].label.of(lang) : '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.text),
                        ),
                      ),
                      pop(phase(t, 0.6, 0.75), const Icon(Icons.trending_up, color: Brand.green, size: 22)),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Expanded(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        for (var i = 0; i < bars.length; i++) ...[
                          if (i > 0) const SizedBox(width: 10),
                          Expanded(
                            child: FractionallySizedBox(
                              heightFactor: bars[i] * phase(t, 0.1 + i * 0.06, 0.4 + i * 0.06),
                              alignment: Alignment.bottomCenter,
                              child: Container(
                                decoration: BoxDecoration(color: i >= 5 ? Brand.blue : Brand.bubble, borderRadius: BorderRadius.circular(6)),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        Positioned(
          left: 20,
          right: 20,
          bottom: 30,
          child: Row(
            children: [
              for (var i = 0; i < math.min(2, scene.items.length); i++) ...[
                if (i > 0) const SizedBox(width: 12),
                Expanded(
                  child: pop(
                    phase(t, 0.45 + i * 0.12, 0.6 + i * 0.12),
                    Container(
                      height: 118,
                      decoration: _card(18),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Container(
                            width: 46,
                            height: 46,
                            decoration: BoxDecoration(color: i == 0 ? Brand.blueSoft : Brand.blue, borderRadius: BorderRadius.circular(14)),
                            child: Icon(scene.items[i].icon, color: i == 0 ? Brand.blue : Colors.white, size: 24),
                          ),
                          const SizedBox(height: 10),
                          Text(
                            scene.items[i].label.of(lang),
                            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.text),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// The last scene: the app's mark, with a tick.
class _EndScene extends StatelessWidget {
  const _EndScene({required this.t});
  final double t;
  @override
  Widget build(BuildContext context) {
    final p = phase(t, 0, 0.35);
    final ring = phase(t, 0.1, 0.9, Curves.easeOut);
    return Container(
      decoration: BoxDecoration(color: Brand.blue, borderRadius: BorderRadius.circular(28)),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Rings spreading out
          for (var i = 0; i < 2; i++)
            Opacity(
              opacity: (1 - ((ring + i * 0.5) % 1)) * 0.35,
              child: Container(
                width: 140 + 200 * ((ring + i * 0.5) % 1),
                height: 140 + 200 * ((ring + i * 0.5) % 1),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 2),
                ),
              ),
            ),
          pop(p, Image.asset('assets/splash_mark.png', width: 170, height: 170, errorBuilder: (_, _, _) => const Icon(Icons.storefront, color: Colors.white, size: 90))),
          Positioned(
            right: 100,
            top: 120,
            child: pop(
              phase(t, 0.3, 0.5),
              Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(color: Brand.green, shape: BoxShape.circle),
                child: const Icon(Icons.check, color: Colors.white, size: 26),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
