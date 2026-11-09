import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/main.dart';

/// Opens every screen at small and normal phone sizes and fails on any layout overflow or error.
const screens = [
  'login',
  'signup',
  'signup_code',
  'desk',
  'bills',
  'reviews',
  'team',
  'setup',
  'setup_services',
  'setup_team',
  'setup_business',
  'setup_whatsapp',
  'setup_templates',
  'checkout',
  'new_bill',
  'new_booking',
  'appointment',
  'bill',
  'booking_flow',
  'chats',
  'chat',
  'chat_ai',
  'chat_closed',
  'contacts',
  'new_contact',
  'campaigns',
  'new_campaign',
  'templates',
  'template',
  'more',
  'sync',
  'knowledge',
  'article',
  'assistant',
];

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

late AppState app;

void main() {
  setUpAll(() async {
    await loadFonts();
    final dir = await Directory.systemTemp.createTemp('wama_screens');
    final store = LocalStore();
    await store.open(path: dir.path);
    await store.clear();
    app = AppState(backend: DemoBackend(), store: store);
    await app.refreshAll();
  });
  for (final (width, scale) in [(320.0, 1.0), (412.0, 1.0), (360.0, 1.3)]) {
    for (final name in screens) {
      testWidgets('$name fits at ${width.toInt()}px${scale > 1 ? ' with large text' : ''}', (tester) async {
        final problems = <String>[];
        final old = FlutterError.onError;
        FlutterError.onError = (d) {
          final at = RegExp(r'lib/[\w/]+\.dart:\d+').allMatches(d.toString()).map((m) => m.group(0)).toSet().join(' ');
          problems.add('${d.exceptionAsString().split('\n').first} $at');
        };
        tester.view.physicalSize = Size(width, 2200);
        tester.view.devicePixelRatio = 1;
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        addTearDown(tester.view.reset);
        await tester.pumpWidget(WamaApp(app: app, screen: name));
        for (var i = 0; i < 12; i++) {
          await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 60)));
          await tester.pump(const Duration(milliseconds: 100));
        }
        FlutterError.onError = old;
        expect(problems, isEmpty, reason: problems.toSet().join('\n'));
        await tester.pumpWidget(const SizedBox());
      });
    }
  }

  // Sheets and steps that open after a tap
  const flows = <(String, List<String>)>[
    ('setup_services', ['Haircut (Women)']),
    ('setup_services', ['Categories']),
    ('setup_services', ['Add service']),
    ('setup_team', ['Anitha']),
    ('setup_team', ['Add person']),
    ('setup_templates', ['Bill']),
    ('setup_templates', ['Booking confirmed']),
    ('setup_templates', ['Booking confirmed', 'Use suggested']),
    ('new_bill', ['Haircut (Men)', 'Gold facial']),
    ('new_booking', ['Haircut (Men)']),
    ('checkout', ['Manicure']),
    ('bill', ['Cancel this bill']),
    ('appointment', ['Done · make the bill']),
    ('reviews', ['To call back · 1']),
    ('booking_flow', ['2. Pick services']),
  ];
  for (final (width, scale) in [(320.0, 1.0), (360.0, 1.3)]) {
    for (final (name, taps) in flows) {
      testWidgets('$name → ${taps.join(' → ')} fits at ${width.toInt()}px${scale > 1 ? ' with large text' : ''}', (tester) async {
        final problems = <String>[];
        final old = FlutterError.onError;
        FlutterError.onError = (d) {
          final at = RegExp(r'lib/[\w/]+\.dart:\d+').allMatches(d.toString()).map((m) => m.group(0)).toSet().join(' ');
          problems.add('${d.exceptionAsString().split('\n').first} $at');
        };
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        addTearDown(tester.view.reset);
        await tester.pumpWidget(WamaApp(app: app, screen: name));
        Future<void> settle() async {
          for (var i = 0; i < 8; i++) {
            await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
            await tester.pump(const Duration(milliseconds: 100));
          }
        }

        await settle();
        for (final t in taps) {
          final f = find.text(t).last;
          await tester.ensureVisible(f);
          await tester.pump();
          await tester.tap(f, warnIfMissed: false);
          await settle();
        }
        FlutterError.onError = old;
        expect(problems, isEmpty, reason: problems.toSet().join('\n'));
        await tester.pumpWidget(const SizedBox());
      });
    }
  }
}
