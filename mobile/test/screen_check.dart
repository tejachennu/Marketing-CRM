import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/main.dart';

/// Opens screens (and the sheets behind a few taps) at small and normal phone sizes and with large
/// phone text, and fails on any layout overflow or error. Each test file gets its own demo app.

Future<void> loadFonts() async {
  final dir = '${Platform.environment['FLUTTER_ROOT'] ?? '/opt/flutter-sdk/flutter'}/bin/cache/artifacts/material_fonts';
  // The real font, also under the name tests use for text with no font set (buttons, chips)
  for (final family in ['Roboto', 'FlutterTest']) {
    final roboto = FontLoader(family);
    for (final f in ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Bold.ttf', 'Roboto-Black.ttf']) {
      roboto.addFont(Future.value(ByteData.sublistView(File('$dir/$f').readAsBytesSync())));
    }
    await roboto.load();
  }
  final icons = FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File('$dir/MaterialIcons-Regular.otf').readAsBytesSync())));
  await icons.load();
}

void screenChecks({List<String> screens = const [], List<(String, List<String>)> flows = const []}) {
  late AppState app;
  setUpAll(() async {
    await loadFonts();
    final dir = await Directory.systemTemp.createTemp('wama_screens');
    final store = LocalStore();
    await store.open(path: dir.path);
    await store.clear();
    app = AppState(backend: DemoBackend(), store: store);
    await app.refreshAll();
  });

  Future<void> check(WidgetTester tester, String name, List<String> taps, double width, double height, double scale) async {
    final problems = <String>[];
    final old = FlutterError.onError;
    FlutterError.onError = (d) {
      final at = RegExp(r'lib/[\w/]+\.dart:\d+').allMatches(d.toString()).map((m) => m.group(0)).toSet().join(' ');
      problems.add('${d.exceptionAsString().split('\n').first} $at');
    };
    tester.view.physicalSize = Size(width, height);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = scale;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(WamaApp(app: app, screen: name));
    Future<void> settle() async {
      for (var i = 0; i < 12; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 60)));
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    await settle();
    for (final t in taps) {
      final starts = find.byWidgetPredicate((w) => w is Text && (w.data ?? '').startsWith(t));
      if (starts.evaluate().isEmpty) {
        problems.add('No "$t" on the screen: ${find.byType(Text).evaluate().map((e) => (e.widget as Text).data).whereType<String>().take(25).join(' | ')}');
        break;
      }
      await tester.ensureVisible(starts.last);
      await tester.pump();
      await tester.tap(starts.last, warnIfMissed: false);
      await settle();
    }
    // Leave the screen and let what it was saving (opening a chat marks it read) finish on this test's clock
    await tester.pumpWidget(const SizedBox());
    for (var i = 0; i < 40 && (i < 6 || app.outbox.isNotEmpty); i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
      await tester.pump(const Duration(milliseconds: 300));
    }
    FlutterError.onError = old;
    expect(problems, isEmpty, reason: problems.toSet().join('\n'));
  }

  for (final (width, scale) in [(320.0, 1.0), (412.0, 1.0), (360.0, 1.3)]) {
    final size = '${width.toInt()}px${scale > 1 ? ' with large text' : ''}';
    for (final name in screens) {
      testWidgets('$name fits at $size', (tester) => check(tester, name, const [], width, 2200, scale));
    }
    if (width == 412) continue;
    for (final (name, taps) in flows) {
      testWidgets('$name → ${taps.join(' → ')} fits at $size', (tester) => check(tester, name, taps, width, 900, scale));
    }
  }
}
