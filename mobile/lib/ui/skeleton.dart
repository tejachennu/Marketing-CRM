import 'package:flutter/material.dart';

import 'theme.dart';

/// Grey shapes that gently pulse while a list loads for the first time (no gradients).
class Pulse extends StatefulWidget {
  const Pulse({super.key, required this.child});
  final Widget child;
  @override
  State<Pulse> createState() => _PulseState();
}

class _PulseState extends State<Pulse> with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(opacity: Tween(begin: 0.45, end: 1.0).animate(_controller), child: widget.child);
}

class Bone extends StatelessWidget {
  const Bone({super.key, this.width, this.height = 12, this.radius = 6});
  final double? width;
  final double height;
  final double radius;
  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: height,
    decoration: BoxDecoration(color: Brand.line, borderRadius: BorderRadius.circular(radius)),
  );
}

/// Rows like a list of people or chats: a round picture and two lines.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.rows = 7, this.avatar = true, this.padding = EdgeInsets.zero});
  final int rows;
  final bool avatar;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) {
    return Pulse(
      child: ListView.builder(
        padding: padding,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: rows,
        itemBuilder: (context, i) => Container(
          color: Colors.white,
          margin: const EdgeInsets.only(bottom: 1),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              if (avatar) ...[const Bone(width: 44, height: 44, radius: 14), const SizedBox(width: 14)],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Bone(width: 120.0 + (i % 3) * 40, height: 13),
                    const SizedBox(height: 8),
                    Bone(width: 180.0 + (i % 2) * 50, height: 11),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              const Bone(width: 36, height: 11),
            ],
          ),
        ),
      ),
    );
  }
}

/// Two number tiles and a few cards, for dashboards like the Front Desk.
class SkeletonCards extends StatelessWidget {
  const SkeletonCards({super.key, this.tiles = true, this.cards = 4});
  final bool tiles;
  final int cards;
  @override
  Widget build(BuildContext context) {
    Widget card(double height) => Container(
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Brand.line),
      ),
      padding: const EdgeInsets.all(14),
      child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Bone(width: 90), SizedBox(height: 12), Bone(width: 150, height: 20), SizedBox(height: 10), Bone(width: 110)]),
    );
    return Pulse(
      child: ListView(
        padding: const EdgeInsets.all(16),
        physics: const NeverScrollableScrollPhysics(),
        children: [
          if (tiles)
            Row(
              children: [
                Expanded(child: card(108)),
                const SizedBox(width: 10),
                Expanded(child: card(108)),
              ],
            ),
          for (var i = 0; i < cards; i++) ...[const SizedBox(height: 12), card(96)],
        ],
      ),
    );
  }
}
