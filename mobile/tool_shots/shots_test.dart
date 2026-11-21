import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/main.dart';

import '../test/screen_check.dart' show loadFonts;

/// Pictures of app screens for review (not part of `flutter test`): SHOTS=chat,members flutter test tool_shots
/// --update-goldens. They land in tool_shots/out/ (not committed).
void main() {
  late AppState app;
  setUpAll(() async {
    await loadFonts();
    final dir = await Directory.systemTemp.createTemp('wama_shots');
    final store = LocalStore();
    await store.open(path: dir.path);
    await store.clear();
    app = AppState(backend: DemoBackend(), store: store);
    await app.refreshAll();
  });
  final names = (Platform.environment['SHOTS'] ?? 'chat').split(',').where((s) => s.isNotEmpty);
  for (final name in names) {
    testWidgets('shot $name', (tester) async {
      tester.view.physicalSize = const Size(1080, 2280);
      tester.view.devicePixelRatio = 2.75;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(RepaintBoundary(child: WamaApp(app: app, screen: name)));
      for (var i = 0; i < 14; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 60)));
        await tester.pump(const Duration(milliseconds: 100));
      }
      await expectLater(find.byType(RepaintBoundary).first, matchesGoldenFile('out/$name.png'));
      await tester.pumpWidget(const SizedBox());
      for (var i = 0; i < 10; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
        await tester.pump(const Duration(milliseconds: 300));
      }
    });
  }
}
