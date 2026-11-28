import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/main.dart';

import 'screen_check.dart' show loadFonts;

/// With the phone's keyboard open (owner, 28 Nov 2026: "half screen hide avendi, crop avi"): on a small phone
/// (360 × 640) each text box of a screen is tapped, the keyboard takes the lower 300 px, and the box must stay
/// in sight above it, with nothing overflowing or cut.
const keyboardHeight = 300.0;

void keyboardChecks(List<String> screens, {DemoBackend Function()? backend, int maxFields = 6}) {
  late AppState app;
  setUpAll(() async {
    await loadFonts();
    final dir = await Directory.systemTemp.createTemp('wama_keyboard');
    final store = LocalStore();
    await store.open(path: dir.path);
    await store.clear();
    app = AppState(backend: backend?.call() ?? DemoBackend(), store: store);
    await app.refreshAll();
  });

  for (final name in screens) {
    testWidgets('$name: text boxes stay in sight with the keyboard open', (tester) async {
      final problems = <String>[];
      const size = Size(360, 640);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      Future<void> settle() async {
        for (var i = 0; i < 10; i++) {
          await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
          await tester.pump(const Duration(milliseconds: 100));
        }
      }

      await tester.pumpWidget(WamaApp(app: app, screen: name));
      await settle();
      final boxes = find.byType(EditableText).hitTestable();
      final count = boxes.evaluate().length;
      final picks = <int>{for (var i = 0; i < math.min(count, maxFields); i++) i, if (count > 0) count - 1};
      for (final i in picks) {
        try {
          final all = find.byType(EditableText);
          if (i >= all.evaluate().length) break;
          final box = all.at(i);
          final label = _labelOf(tester, box);
          await tester.ensureVisible(box);
          await tester.pump();
          await tester.tap(box, warnIfMissed: false);
          await tester.pump();
          tester.view.viewInsets = const FakeViewPadding(bottom: keyboardHeight);
          await settle();
          if (box.evaluate().isNotEmpty) {
            final rect = tester.getRect(box);
            final visibleBottom = size.height - keyboardHeight;
            final needed = rect.top + math.min(rect.height, 40);
            if (needed > visibleBottom + 1 || rect.bottom < 0)
              problems.add('"$label" is behind the keyboard (top ${rect.top.round()}, keyboard from ${visibleBottom.round()})');
          }
          // The form's bottom bar (Save, Bill, Next) rides above the keyboard; the app's tab bar may hide
          for (final scaffold in find.byType(Scaffold).evaluate()) {
            final bar = (scaffold.widget as Scaffold).bottomNavigationBar;
            if (bar == null) continue;
            final inBar = find.descendant(of: find.byWidget(bar), matching: find.byWidgetPredicate((w) => w is ButtonStyleButton));
            if (find.descendant(of: find.byWidget(bar), matching: find.byType(NavigationBar)).evaluate().isNotEmpty) continue;
            for (final button in inBar.evaluate()) {
              final render = button.renderObject as RenderBox;
              final at = render.localToGlobal(Offset.zero) & render.size;
              if (at.bottom > size.height - keyboardHeight + 1) problems.add('A bottom button is behind the keyboard (top ${at.top.round()})');
            }
          }
        } on RangeError {
          // The screen changed while typing (a box appeared or went): nothing more to check
          break;
        } catch (e) {
          problems.add('Text box ${i + 1}: ${'$e'.split('\n').first}');
        }
        tester.view.viewInsets = FakeViewPadding.zero;
        FocusManager.instance.primaryFocus?.unfocus();
        await settle();
      }
      await tester.pumpWidget(const SizedBox());
      for (var i = 0; i < 20 && (i < 4 || app.outbox.isNotEmpty); i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
        await tester.pump(const Duration(milliseconds: 300));
      }
      expect(problems, isEmpty, reason: '$name ($count text boxes):\n${problems.toSet().join('\n')}');
    }, timeout: const Timeout(Duration(seconds: 90)));
  }
}

String _labelOf(WidgetTester tester, Finder box) {
  final field = find.ancestor(of: box, matching: find.byType(TextField));
  if (field.evaluate().isNotEmpty) {
    final d = tester.widget<TextField>(field.first).decoration;
    final text = d?.labelText ?? d?.hintText;
    if (text != null && text.isNotEmpty) return text;
  }
  return 'text box';
}
