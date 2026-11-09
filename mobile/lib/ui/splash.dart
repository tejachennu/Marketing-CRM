import 'package:flutter/material.dart';

import 'theme.dart';

/// The opening screen: on WhatsApp's dark green (the same as the phone's own start screen, so it
/// flows on), the logo pops in, then the name and a line fade up, with three dots while it loads.
class SplashApp extends StatelessWidget {
  const SplashApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(), home: const SplashScreen());
}

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});
  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with TickerProviderStateMixin {
  late final _intro = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..forward();
  late final _dots = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat();

  @override
  void dispose() {
    _intro.dispose();
    _dots.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pop = CurvedAnimation(
      parent: _intro,
      curve: const Interval(0, 0.6, curve: Curves.easeOutBack),
    );
    final fade = CurvedAnimation(
      parent: _intro,
      curve: const Interval(0.45, 1, curve: Curves.easeOut),
    );
    return Scaffold(
      backgroundColor: Brand.blue,
      body: Stack(
        children: [
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ScaleTransition(
                  scale: Tween(begin: 0.55, end: 1.0).animate(pop),
                  child: FadeTransition(
                    opacity: CurvedAnimation(parent: _intro, curve: const Interval(0, 0.3)),
                    child: Image.asset('assets/splash_mark.png', width: 168, height: 168),
                  ),
                ),
                const SizedBox(height: 12),
                FadeTransition(
                  opacity: fade,
                  child: SlideTransition(
                    position: Tween(begin: const Offset(0, 0.4), end: Offset.zero).animate(fade),
                    child: const Column(
                      children: [
                        Text(
                          'WAMA CRM',
                          style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: 0.5),
                        ),
                        SizedBox(height: 6),
                        Text('Front Desk · Chats · Bills', style: TextStyle(color: Color(0xCCFFFFFF), fontSize: 15)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 56,
            child: AnimatedBuilder(
              animation: _dots,
              builder: (context, _) => Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 0; i < 3; i++)
                    Container(
                      width: 8,
                      height: 8,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        // each dot lights up in turn
                        color: Colors.white.withValues(alpha: ((_dots.value * 3).floor() % 3 == i) ? 0.95 : 0.35),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
