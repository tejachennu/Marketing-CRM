// Records the explainer videos for a look outside the app (not part of the test run: no _test in the name). Draws
// every scene frame by frame from the player itself, then the screen after the video. Like the player, a scene lasts
// until its recorded voice line has finished (design/voice/durations.json); each folder gets timeline.json (when each
// clip starts) for design/voice/mux_videos.py, which puts the voice in and makes the MP4s.
//   VIDEOS_DIR=/tmp/videos VIDEOS=grow:en,website:te FPS=12 flutter test test/record_videos.dart
//   python3 design/voice/mux_videos.py /tmp/videos
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/screens/explainers/explainer_content.dart';
import 'package:wama_mobile/screens/explainers/explainer_player.dart';
import 'package:wama_mobile/screens/explainers/narrator.dart';
import 'package:wama_mobile/ui/theme.dart';

void main() {
  late AppState app;
  final out = Platform.environment['VIDEOS_DIR'] ?? '/tmp/videos';
  final fps = int.tryParse(Platform.environment['FPS'] ?? '') ?? 12;
  final durationsFile = File(Platform.environment['VOICE_DURATIONS'] ?? 'design/voice/durations.json');
  final voiceMs = durationsFile.existsSync() ? Map<String, num>.from(jsonDecode(durationsFile.readAsStringSync()) as Map) : <String, num>{};
  final wanted = (Platform.environment['VIDEOS'] ?? 'grow:en').split(',').where((s) => s.contains(':')).map((s) => (s.split(':')[0], s.split(':')[1])).toList();

  setUpAll(() async {
    const fonts0 = '/opt/flutter/bin/cache/artifacts/material_fonts';
    final icons = FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File('$fonts0/MaterialIcons-Regular.otf').readAsBytesSync())));
    await icons.load();
    for (final (family, files) in [
      ('NotoSansTelugu', ['NotoSansTelugu-Regular.ttf', 'NotoSansTelugu-Bold.ttf']),
      ('NotoSansDevanagari', ['NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari-Bold.ttf']),
      ('NotoColorEmoji', ['NotoColorEmoji.ttf']),
    ]) {
      final loader = FontLoader(family);
      for (final f in files) {
        final file = File('/usr/share/fonts/truetype/noto/$f');
        if (file.existsSync()) loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
      }
      await loader.load();
    }
    for (final family in ['Roboto', 'Ahem']) {
      final roboto = FontLoader(family);
      for (final f in ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Bold.ttf']) {
        roboto.addFont(Future.value(ByteData.sublistView(File('$fonts0/$f').readAsBytesSync())));
      }
      await roboto.load();
    }
    final dir = await Directory.systemTemp.createTemp('wama_videos');
    final store = LocalStore();
    await store.open(path: dir.path);
    await store.clear();
    app = AppState(backend: DemoBackend(), store: store);
    await app.refreshAll();
  });

  for (final (id, lang) in wanted) {
    testWidgets('record $id in $lang', (tester) async {
      tester.view.physicalSize = const Size(720, 1480);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      final folder = Directory('$out/${id}_$lang')..createSync(recursive: true);
      final ex = explainers.firstWhere((e) => e.id == id);
      final scenes = scenesFor(ex, indianLanguagesOn(app));
      final key = GlobalKey();
      var frame = 0;

      Future<void> shoot(Widget screen) async {
        await tester.pumpWidget(
          RepaintBoundary(
            key: key,
            child: AppScope(
              state: app,
              child: MaterialApp(
                key: ValueKey(frame),
                debugShowCheckedModeBanner: false,
                theme: buildTheme(),
                home: screen,
                builder: (context, child) => _Roboto(child: child!),
              ),
            ),
          ),
        );
        await tester.pump();
        await tester.runAsync(() async {
          final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
          final image = await boundary.toImage(pixelRatio: 1.5);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          File('${folder.path}/${frame.toString().padLeft(5, '0')}.png').writeAsBytesSync(bytes!.buffer.asUint8List());
        });
        frame++;
      }

      final timeline = <Map<String, Object>>[];
      for (var i = 0; i < scenes.length; i++) {
        final clip = voiceClipName(spokenWords(scenes[i], lang), lang);
        final voice = (voiceMs[clip] ?? 0).toInt();
        timeline.add({'start_ms': (frame * 1000 / fps).round(), 'clip': clip});
        // As in the player: the scene lasts as long as its words and a short breath
        final total = voice > 0 ? (voice + 250 > 2500 ? voice + 250 : 2500) : scenes[i].ms;
        final n = (total / 1000 * fps).round();
        for (var f = 0; f < n; f++) {
          final played = (f / fps * 1000) / total;
          await shoot(ExplainerScreen(startId: id, startScene: i, holdAt: played > 1 ? 1 : played, autoplay: false, lang: lang));
        }
      }
      File('${folder.path}/timeline.json').writeAsStringSync(jsonEncode({'fps': fps, 'clips': timeline}));
      // The screen after the video, for two seconds
      for (var f = 0; f < fps * 2; f++) {
        await shoot(ExplainerScreen(startId: id, autoplay: false, showEnd: true, lang: lang));
      }
      await tester.pumpWidget(const SizedBox());
    }, timeout: const Timeout(Duration(minutes: 20)));
  }
}

class _Roboto extends StatelessWidget {
  const _Roboto({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    WidgetStateProperty<TextStyle?>? fix(WidgetStateProperty<TextStyle?>? p) => p == null ? null : WidgetStateProperty.resolveWith((s) => p.resolve(s)?.copyWith(fontFamily: 'Roboto'));
    return Theme(
      data: t.copyWith(
        textTheme: t.textTheme.apply(fontFamily: 'Roboto', fontFamilyFallback: const ['NotoSansTelugu', 'NotoSansDevanagari', 'NotoColorEmoji']),
        filledButtonTheme: FilledButtonThemeData(style: t.filledButtonTheme.style?.copyWith(textStyle: fix(t.filledButtonTheme.style?.textStyle))),
        outlinedButtonTheme: OutlinedButtonThemeData(style: t.outlinedButtonTheme.style?.copyWith(textStyle: fix(t.outlinedButtonTheme.style?.textStyle))),
        textButtonTheme: TextButtonThemeData(style: t.textButtonTheme.style?.copyWith(textStyle: fix(t.textButtonTheme.style?.textStyle))),
      ),
      child: DefaultTextStyle.merge(style: const TextStyle(fontFamily: 'Roboto', fontFamilyFallback: ['NotoSansTelugu', 'NotoSansDevanagari', 'NotoColorEmoji']), child: child),
    );
  }
}
