// Pictures of the sign-in, sign-up, welcome and delete-account screens, for a design check. Not part of the test run
// (no _test in the name). Text is drawn in Roboto (flutter test otherwise draws boxes for text with no font set).
//   SHOTS_DIR=/tmp/shots SHOTS_SIZES=360x780,320x640,360x740@1.3 SHOTS=welcome,signup flutter test test/screenshots.dart
// Sizes are width x height, "@1.3" = large phone text. SHOTS picks screens (all when empty).
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/screens/auth/login_screen.dart';
import 'package:wama_mobile/screens/auth/signup_screen.dart';
import 'package:wama_mobile/screens/more/delete_account_screen.dart';
import 'package:wama_mobile/screens/onboarding/onboarding_screen.dart';
import 'package:wama_mobile/ui/theme.dart';

import 'screen_check.dart' show loadFonts;

void main() {
  late AppState app;
  final out = Platform.environment['SHOTS_DIR'] ?? '/tmp/shots';
  setUpAll(() async {
    await loadFonts();
    // Text with no font family falls back to the test font: show it as Roboto, like a phone
    const fonts = '/opt/flutter/bin/cache/artifacts/material_fonts';
    for (final family in ['Ahem', '']) {
      final roboto = FontLoader(family);
      for (final f in ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Bold.ttf']) {
        roboto.addFont(Future.value(ByteData.sublistView(File('$fonts/$f').readAsBytesSync())));
      }
      await roboto.load();
    }
    final dir = await Directory.systemTemp.createTemp('wama_shots');
    final store = LocalStore();
    await store.open(path: dir.path);
    await store.clear();
    app = AppState(backend: DemoBackend(), store: store);
    await app.refreshAll();
    Directory(out).createSync(recursive: true);
  });

  final screens = <String, Widget Function()>{
    'welcome': () => const LoginScreen(),
    'signin': () => const LoginScreen(startOnSignIn: true),
    'signup': () => const SignupScreen(),
    'signup_code': () => const SignupScreen(demoCodeStep: true),
    'onb_desk': () => const OnboardingScreen(),
    'onb_shop': () => const OnboardingScreen(startPage: 1),
    'onb_nowa': () => const OnboardingScreen(startPage: 2),
    'onb_pick': () => const OnboardingScreen(startPage: 3),
    'onb_whatsapp': () => const OnboardingScreen(startPage: 4),
    'delete_account': () => const DeleteAccountScreen(),
  };
  final only = (Platform.environment['SHOTS'] ?? '').split(',').where((s) => s.isNotEmpty).toSet();
  final sizes = (Platform.environment['SHOTS_SIZES'] ?? '360x780').split(',');

  for (final entry in screens.entries) {
    if (only.isNotEmpty && !only.contains(entry.key)) continue;
    for (final size in sizes) {
      final parts = size.split('x');
      final w = double.parse(parts[0]);
      final h = double.parse(parts[1].split('@').first);
      final scale = parts[1].contains('@') ? double.parse(parts[1].split('@')[1]) : 1.0;
      testWidgets('shot ${entry.key} $size', (tester) async {
        final problems = <String>[];
        final old = FlutterError.onError;
        FlutterError.onError = (d) => problems.add(d.exceptionAsString().split('\n').first);
        tester.view.physicalSize = Size(w * 2, h * 2);
        tester.view.devicePixelRatio = 2;
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        addTearDown(tester.view.reset);
        final key = GlobalKey();
        await tester.pumpWidget(
          RepaintBoundary(
            key: key,
            child: AppScope(
              state: app,
              child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(), home: entry.value(), builder: (context, child) => _Roboto(child: child!)),
            ),
          ),
        );
        for (var i = 0; i < 14; i++) {
          await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 60)));
          await tester.pump(const Duration(milliseconds: 120));
        }
        await tester.runAsync(() async {
          final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
          final image = await boundary.toImage(pixelRatio: 2);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          File('$out/${entry.key}_$size.png').writeAsBytesSync(bytes!.buffer.asUint8List());
        });
        await tester.pumpWidget(const SizedBox());
        FlutterError.onError = old;
        expect(problems, isEmpty, reason: problems.toSet().join('\n'));
      });
    }
  }
}

/// Screenshots only: every text in Roboto (the test runner otherwise draws boxes for text with no font set).
class _Roboto extends StatelessWidget {
  const _Roboto({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    WidgetStateProperty<TextStyle?>? fix(WidgetStateProperty<TextStyle?>? p) => p == null ? null : WidgetStateProperty.resolveWith((s) => p.resolve(s)?.copyWith(fontFamily: 'Roboto'));
    return Theme(
      data: t.copyWith(
        textTheme: t.textTheme.apply(fontFamily: 'Roboto'),
        primaryTextTheme: t.primaryTextTheme.apply(fontFamily: 'Roboto'),
        filledButtonTheme: FilledButtonThemeData(style: t.filledButtonTheme.style?.copyWith(textStyle: fix(t.filledButtonTheme.style?.textStyle))),
        outlinedButtonTheme: OutlinedButtonThemeData(style: t.outlinedButtonTheme.style?.copyWith(textStyle: fix(t.outlinedButtonTheme.style?.textStyle))),
        textButtonTheme: TextButtonThemeData(style: t.textButtonTheme.style?.copyWith(textStyle: fix(t.textButtonTheme.style?.textStyle))),
        appBarTheme: t.appBarTheme.copyWith(titleTextStyle: t.appBarTheme.titleTextStyle?.copyWith(fontFamily: 'Roboto')),
        inputDecorationTheme: t.inputDecorationTheme.copyWith(
          labelStyle: t.inputDecorationTheme.labelStyle?.copyWith(fontFamily: 'Roboto'),
          hintStyle: t.inputDecorationTheme.hintStyle?.copyWith(fontFamily: 'Roboto'),
        ),
      ),
      child: DefaultTextStyle.merge(style: const TextStyle(fontFamily: 'Roboto'), child: child),
    );
  }
}
