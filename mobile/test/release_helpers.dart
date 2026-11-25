import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/main.dart';

import 'screen_check.dart' show loadFonts;

/// Release checks (owner, 24 Nov 2026: "with WhatsApp integration and without ... 14 days free trial, after they
/// need to do payment"). One kind of workspace per test file: the phone store can be opened once per file.
class Release {
  late AppState app;
  late DemoBackend backend;
}

/// Makes the file's app once, before its tests: [billing] 'trial' (10 days left), 'trial2', 'ended', 'paid';
/// [appointments] false: a shop that only bills walk-ins (Front Desk → Setup → Appointments off).
Release releaseApp({String billing = 'trial', bool staff = false, bool whatsapp = true, bool starter = false, bool newSignup = false, bool appointments = true}) {
  final r = Release();
  setUpAll(() async {
    await loadFonts();
    final dir = await Directory.systemTemp.createTemp('wama_release');
    final store = LocalStore();
    await store.open(path: dir.path);
    await store.clear();
    r.backend = DemoBackend(billing: billing, staff: staff, whatsapp: whatsapp, starter: starter, appointments: appointments);
    r.app = AppState(backend: r.backend, store: store);
    await r.app.refreshAll();
    if (newSignup) await store.write('onboarding', {'pending': true});
  });
  return r;
}

/// Opens the app as a person would (no preview screen), runs [steps], and fails on any layout problem.
Future<void> useApp(WidgetTester tester, AppState app, Future<void> Function() steps, {double width = 360, double height = 780}) async {
  final problems = <String>[];
  final old = FlutterError.onError;
  FlutterError.onError = (d) => problems.add(d.exceptionAsString().split('\n').first);
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(WamaApp(app: app));
  await settle(tester);
  try {
    await steps();
  } finally {
    await tester.pumpWidget(const SizedBox());
    await settle(tester);
    FlutterError.onError = old;
  }
  expect(problems, isEmpty, reason: problems.toSet().join('\n'));
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Scrolls down (as a person would) until [finder] is built: long lists build only what is near the screen.
Future<Finder> reach(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 15 && finder.evaluate().isEmpty; i++) {
    final lists = find.byType(Scrollable);
    if (lists.evaluate().isEmpty) break;
    await tester.drag(lists.last, const Offset(0, -250), warnIfMissed: false);
    await settle(tester);
  }
  return finder;
}

Future<void> tapText(WidgetTester tester, String text) async {
  final found = await reach(tester, find.text(text));
  expect(found, findsWidgets, reason: 'No "$text" on the screen');
  await tester.ensureVisible(found.last);
  // Lay out the scrolled list first, or the tap lands where the text was before
  await tester.pump();
  await tester.tap(found.last, warnIfMissed: false);
  await settle(tester);
}
