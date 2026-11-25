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
import 'package:wama_mobile/screens/explainers/explainer_content.dart';
import 'package:wama_mobile/screens/explainers/explainer_player.dart';
import 'package:wama_mobile/screens/more/expenses_screen.dart';
import 'package:wama_mobile/ui/theme.dart';


void main() {
  late AppState app;
  final out = Platform.environment['SHOTS_DIR'] ?? '/tmp/shots';
  setUpAll(() async {
    // Material icons, and Telugu / Hindi letters (Noto, from the system fonts) as fallbacks
    const fonts0 = '/opt/flutter/bin/cache/artifacts/material_fonts';
    final icons = FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File('$fonts0/MaterialIcons-Regular.otf').readAsBytesSync())));
    await icons.load();
    for (final (family, files) in [
      ('NotoSansTelugu', ['NotoSansTelugu-Regular.ttf', 'NotoSansTelugu-Bold.ttf']),
      ('NotoSansDevanagari', ['NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari-Bold.ttf']),
    ]) {
      final loader = FontLoader(family);
      for (final f in files) {
        final file = File('/usr/share/fonts/truetype/noto/$f');
        if (file.existsSync()) loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
      }
      await loader.load();
    }
    // Text with no font family falls back to the test font: show it as Roboto, like a phone
    const fonts = '/opt/flutter/bin/cache/artifacts/material_fonts';
    for (final family in ['Roboto', 'Ahem']) {
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
    'onb_desk': () => const OnboardingScreen(startPage: 1),
    'onb_shop': () => const OnboardingScreen(startPage: 2),
    'onb_nowa': () => const OnboardingScreen(startPage: 3),
    'onb_pick': () => const OnboardingScreen(startPage: 4),
    'onb_whatsapp': () => const OnboardingScreen(startPage: 5),
    'delete_account': () => const DeleteAccountScreen(),
    'expenses': () => const ExpensesScreen(),
    'expense_new': () => const ExpenseFormScreen(month: '2026-11'),
    'onb_videos': () => const OnboardingScreen(),
    'video_end': () => const ExplainerScreen(startId: 'grow', autoplay: false, showEnd: true),
    'video_end_te': () => const ExplainerScreen(startId: 'grow', autoplay: false, showEnd: true, lang: 'te'),
    'web_store': () => const ExplainerScreen(startId: 'website', autoplay: false, startScene: 0, holdAt: 0.8),
    'web_desk': () => const ExplainerScreen(startId: 'website', autoplay: false, startScene: 1, holdAt: 0.8, lang: 'te'),
    'web_sources': () => const ExplainerScreen(startId: 'website', autoplay: false, startScene: 2, holdAt: 0.8),
    'web_sources_hi': () => const ExplainerScreen(startId: 'website', autoplay: false, startScene: 2, holdAt: 0.8, lang: 'hi'),
    // Every scene of every video, held at 85 %, in each language: video_<id>_<scene>_<lang>
    for (final ex in explainers)
      for (var i = 0; i < ex.scenes.length; i++)
        for (final (lang, _) in videoLanguages) 'video_${ex.id}_${i}_$lang': () => ExplainerScreen(startId: ex.id, startScene: i, holdAt: 0.85, lang: lang),
  };
  final only = (Platform.environment['SHOTS'] ?? '').split(',').where((s) => s.isNotEmpty).toSet();
  // SHOTS=video_ads picks every screen whose name starts with it
  final sizes = (Platform.environment['SHOTS_SIZES'] ?? '360x780').split(',');

  for (final entry in screens.entries) {
    if (only.isNotEmpty && !only.any((o) => entry.key == o || entry.key.startsWith('${o}_'))) continue;
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
        textTheme: t.textTheme.apply(fontFamily: 'Roboto', fontFamilyFallback: const ['NotoSansTelugu', 'NotoSansDevanagari']),
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
      child: DefaultTextStyle.merge(style: const TextStyle(fontFamily: 'Roboto', fontFamilyFallback: ['NotoSansTelugu', 'NotoSansDevanagari']), child: child),
    );
  }
}
