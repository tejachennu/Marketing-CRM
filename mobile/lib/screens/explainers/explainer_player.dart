import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import 'explainer_content.dart';
import 'explainer_scenes.dart';

/// The explainer videos: a player that feels like a story (bars on top, tap the right side for the next scene, the
/// left for the one before, tap the middle to pause), with the words under the picture in English, Telugu or Hindi.
/// The language and what was watched are kept on the phone ('videos').

/// The language the videos play in: the one picked before, else the phone's (Telugu / Hindi), else English.
String videoLanguage(AppState app) {
  final saved = '${app.store.read('videos')?['lang'] ?? ''}';
  if (videoLanguages.any((l) => l.$1 == saved)) return saved;
  final phone = PlatformDispatcher.instance.locale.languageCode;
  return videoLanguages.any((l) => l.$1 == phone) ? phone : 'en';
}

Future<void> _saveVideos(AppState app, {String? lang, String? watched}) async {
  final old = app.store.read('videos') ?? const {};
  final seen = {...((old['watched'] as List?) ?? const []).map((e) => '$e')};
  if (watched != null) seen.add(watched);
  // No language picked yet: keep none, so the phone's language still counts (videoLanguage)
  await app.store.write('videos', {'lang': lang ?? old['lang'], 'watched': seen.toList()});
  // Watch buttons on the welcome pages follow the new language
  if (lang != null) app.changed();
}

Set<String> watchedVideos(AppState app) => {...((app.store.read('videos')?['watched'] as List?) ?? const []).map((e) => '$e')};

/// Opens the player full screen on [start] (an explainer id), then carries on to the next ones.
Future<void> openExplainer(BuildContext context, String start) => Navigator.of(context).push(
  PageRouteBuilder<void>(
    opaque: true,
    transitionDuration: const Duration(milliseconds: 260),
    pageBuilder: (_, _, _) => ExplainerScreen(startId: start),
    transitionsBuilder: (_, a, _, child) => FadeTransition(opacity: a, child: child),
  ),
);

class ExplainerScreen extends StatefulWidget {
  const ExplainerScreen({super.key, required this.startId, this.autoplay = true, this.startScene = 0, this.holdAt, this.lang});
  final String startId;

  /// Tests and screenshots: hold still on the first scene.
  final bool autoplay;

  /// Screenshots: open on this scene, held still at this point of it (0 → 1), in this language.
  final int startScene;
  final double? holdAt;
  final String? lang;
  @override
  State<ExplainerScreen> createState() => _ExplainerScreenState();
}

class _ExplainerScreenState extends State<ExplainerScreen> with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late int _video = explainers.indexWhere((e) => e.id == widget.startId).clamp(0, explainers.length - 1);
  late int _scene = widget.startScene.clamp(0, explainers[_video].scenes.length - 1);
  bool _paused = false;
  bool _ended = false;
  late String? _lang = widget.lang;
  late final AnimationController _clock = AnimationController(vsync: this)..addStatusListener(_onStatus);

  Explainer get _ex => explainers[_video];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Screen readers: start paused, so the words are not swapped while they are being read
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && MediaQuery.accessibleNavigationOf(context) && !_paused) _togglePause();
    });
    _startScene();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _clock.dispose();
    super.dispose();
  }

  /// Leaving the app pauses the video (otherwise the time away would count and skip scenes)
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && !_paused && !_ended) _togglePause();
  }

  void _startScene() {
    _clock.duration = Duration(milliseconds: _ex.scenes[_scene].ms);
    _clock.value = widget.holdAt ?? 0;
    if (widget.autoplay && widget.holdAt == null && !_paused) _clock.forward();
  }

  void _onStatus(AnimationStatus status) {
    if (status != AnimationStatus.completed) return;
    if (_scene < _ex.scenes.length - 1) {
      setState(() => _scene++);
      _startScene();
    } else {
      _finish();
    }
  }

  void _finish() {
    final app = AppScope.read(context);
    _saveVideos(app, watched: _ex.id);
    setState(() => _ended = true);
  }

  void _go(int delta) {
    if (_ended) return;
    final next = _scene + delta;
    if (next < 0) {
      _clock.value = 0;
      if (!_paused) _clock.forward();
      return;
    }
    if (next >= _ex.scenes.length) return _finish();
    setState(() => _scene = next);
    _startScene();
  }

  void _togglePause() {
    if (_ended) return;
    setState(() => _paused = !_paused);
    if (_paused) {
      _clock.stop();
    } else {
      _clock.forward();
    }
  }

  void _playVideo(int index) {
    setState(() {
      _video = index;
      _scene = 0;
      _ended = false;
      _paused = false;
    });
    _startScene();
  }

  Future<void> _setLang(String lang) async {
    setState(() => _lang = lang);
    await _saveVideos(AppScope.read(context), lang: lang);
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final lang = _lang ?? videoLanguage(app);
    final still = MediaQuery.disableAnimationsOf(context);
    final scene = _ex.scenes[_scene];
    return Scaffold(
      backgroundColor: const Color(0xFF0B141A),
      // Large phone text up to 1.3×: beyond that the words would push the controls off a small screen
      body: MediaQuery.withClampedTextScaling(
        maxScaleFactor: 1.3,
        child: SafeArea(
          child: Column(
            children: [
              // Story bars, one per scene
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
                child: Semantics(
                  label: '${_scene + 1} / ${_ex.scenes.length}',
                  child: ExcludeSemantics(
                    child: AnimatedBuilder(
                      animation: _clock,
                      builder: (context, _) => Row(
                        children: [
                          for (var i = 0; i < _ex.scenes.length; i++) ...[
                            if (i > 0) const SizedBox(width: 4),
                            Expanded(
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(99),
                                child: LinearProgressIndicator(
                                  minHeight: 3,
                                  value: _ended || i < _scene ? 1 : (i == _scene ? _clock.value : 0),
                                  backgroundColor: const Color(0x40FFFFFF),
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 6, 4, 0),
                child: Row(
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      margin: const EdgeInsets.only(left: 6, right: 10),
                      decoration: BoxDecoration(color: Brand.blue, borderRadius: BorderRadius.circular(10)),
                      child: Icon(_ex.icon, color: Colors.white, size: 19),
                    ),
                    Expanded(
                      child: Text(
                        _ex.title.of(lang),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Colors.white, fontSize: 14.5, fontWeight: FontWeight.w700, height: 1.25),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.maybePop(context),
                      tooltip: VideoWords.close.of(lang),
                      icon: const Icon(Icons.close, color: Colors.white),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: LanguagePicker(lang: lang, onPick: _setLang, dark: true),
              ),
              Expanded(
                child: _ended
                    ? _endView(lang)
                    : LayoutBuilder(
                        builder: (context, box) => GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTapUp: (d) {
                            final x = d.localPosition.dx / box.maxWidth;
                            if (x < 0.28) {
                              _go(-1);
                            } else if (x > 0.72) {
                              _go(1);
                            } else {
                              _togglePause();
                            }
                          },
                          child: Stack(
                            children: [
                              Positioned.fill(
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 14),
                                  child: FittedBox(
                                    child: AnimatedBuilder(
                                      animation: _clock,
                                      builder: (context, _) => ExcludeSemantics(
                                        child: SceneView(scene: scene, t: still ? 1 : _clock.value, lang: lang),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                              if (_paused)
                                Center(
                                  child: Container(
                                    width: 64,
                                    height: 64,
                                    decoration: const BoxDecoration(color: Color(0x99000000), shape: BoxShape.circle),
                                    child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 40),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
              ),
              // The words for this scene
              if (!_ended)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 6),
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 280),
                    transitionBuilder: (child, a) => FadeTransition(
                      opacity: a,
                      child: SlideTransition(
                        position: Tween(begin: const Offset(0, 0.15), end: Offset.zero).animate(a),
                        child: child,
                      ),
                    ),
                    // Full width, so the words start at the same place in every scene
                    child: SizedBox(
                      key: ValueKey('$_video-$_scene-$lang'),
                      width: double.infinity,
                      child: Semantics(
                        liveRegion: true,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              scene.title.of(lang),
                              style: const TextStyle(color: Colors.white, fontSize: 21, fontWeight: FontWeight.w700, height: 1.25),
                            ),
                            const SizedBox(height: 6),
                            Text(scene.line.of(lang), style: const TextStyle(color: Color(0xD9FFFFFF), fontSize: 15, height: 1.4)),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              if (!_ended)
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 4, 8, 10),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      IconButton(
                        onPressed: () => _go(-1),
                        tooltip: VideoWords.back.of(lang),
                        icon: const Icon(Icons.skip_previous_rounded, color: Colors.white, size: 30),
                      ),
                      const SizedBox(width: 18),
                      IconButton.filled(
                        onPressed: _togglePause,
                        tooltip: _paused ? VideoWords.play.of(lang) : VideoWords.pause.of(lang),
                        style: IconButton.styleFrom(backgroundColor: Colors.white, foregroundColor: const Color(0xFF0B141A), fixedSize: const Size(56, 56)),
                        icon: Icon(_paused ? Icons.play_arrow_rounded : Icons.pause_rounded, size: 32),
                      ),
                      const SizedBox(width: 18),
                      IconButton(
                        onPressed: () => _go(1),
                        tooltip: VideoWords.forward.of(lang),
                        icon: const Icon(Icons.skip_next_rounded, color: Colors.white, size: 30),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// After the last scene: watch again, the next video, or done.
  Widget _endView(String lang) {
    final next = _video + 1 < explainers.length ? _video + 1 : null;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
      children: [
        Center(
          child: Container(
            width: 76,
            height: 76,
            decoration: const BoxDecoration(color: Brand.green, shape: BoxShape.circle),
            child: const Icon(Icons.check_rounded, color: Colors.white, size: 46),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          _ex.scenes.last.title.of(lang),
          textAlign: TextAlign.center,
          style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w700, height: 1.25),
        ),
        const SizedBox(height: 8),
        Text(
          _ex.scenes.last.line.of(lang),
          textAlign: TextAlign.center,
          style: const TextStyle(color: Color(0xD9FFFFFF), fontSize: 15, height: 1.4),
        ),
        const SizedBox(height: 28),
        if (next != null) ...[
          FilledButton.icon(
            onPressed: () => _playVideo(next),
            style: FilledButton.styleFrom(
              backgroundColor: Brand.green,
              foregroundColor: const Color(0xFF0B141A),
              minimumSize: const Size.fromHeight(54),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            icon: const Icon(Icons.play_arrow_rounded),
            label: Text('${VideoWords.next.of(lang)}: ${explainers[next].title.of(lang)}', maxLines: 2, textAlign: TextAlign.center),
          ),
          const SizedBox(height: 10),
        ],
        OutlinedButton.icon(
          onPressed: () => _playVideo(_video),
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.white,
            side: const BorderSide(color: Color(0x66FFFFFF)),
            minimumSize: const Size.fromHeight(50),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
          icon: const Icon(Icons.replay),
          label: Text(VideoWords.again.of(lang)),
        ),
        const SizedBox(height: 10),
        TextButton(
          onPressed: () => Navigator.maybePop(context),
          style: TextButton.styleFrom(foregroundColor: Colors.white, minimumSize: const Size.fromHeight(48)),
          child: Text(VideoWords.done.of(lang)),
        ),
      ],
    );
  }
}

/// More → How we help your business: the same videos, any time.
class ExplainerLibraryScreen extends StatelessWidget {
  const ExplainerLibraryScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.white,
    appBar: AppBar(title: const Text('How we help your business')),
    body: const SafeArea(top: false, child: ExplainerGallery()),
  );
}

/// English | తెలుగు | हिंदी
class LanguagePicker extends StatelessWidget {
  const LanguagePicker({super.key, required this.lang, required this.onPick, this.dark = false});
  final String lang;
  final ValueChanged<String> onPick;
  final bool dark;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      for (final (code, name) in videoLanguages) ...[
        if (code != videoLanguages.first.$1) const SizedBox(width: 8),
        Expanded(
          child: Semantics(
            selected: code == lang,
            button: true,
            child: Material(
              color: code == lang ? (dark ? Colors.white : Brand.blue) : (dark ? const Color(0x26FFFFFF) : Colors.white),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(99),
                side: BorderSide(color: code == lang ? Colors.transparent : (dark ? const Color(0x40FFFFFF) : Brand.border)),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(99),
                onTap: () => onPick(code),
                child: Container(
                  height: 38,
                  alignment: Alignment.center,
                  child: Text(
                    name,
                    maxLines: 1,
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: code == lang ? (dark ? const Color(0xFF0B141A) : Colors.white) : (dark ? Colors.white : Brand.textSoft)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    ],
  );
}

/// The list of videos (welcome page and More): the language, a big first video, then the others.
class ExplainerGallery extends StatefulWidget {
  const ExplainerGallery({super.key, this.padding = const EdgeInsets.fromLTRB(20, 8, 20, 16), this.header});
  final EdgeInsets padding;

  /// Shown above the language (the welcome page's title)
  final Widget? header;
  @override
  State<ExplainerGallery> createState() => _ExplainerGalleryState();
}

class _ExplainerGalleryState extends State<ExplainerGallery> with SingleTickerProviderStateMixin {
  String? _lang;
  // The big card plays its first scene over and over, without sound or words
  late final AnimationController _preview = AnimationController(
    vsync: this,
    duration: Duration(milliseconds: explainers.first.scenes[2].ms),
  );

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !MediaQuery.disableAnimationsOf(context)) _preview.repeat();
    });
  }

  @override
  void dispose() {
    _preview.dispose();
    super.dispose();
  }

  Future<void> _open(String id) async {
    _preview.stop();
    await openExplainer(context, id);
    if (!mounted) return;
    setState(() => _lang = null); // the player may have changed it
    if (!MediaQuery.disableAnimationsOf(context)) _preview.repeat();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final lang = _lang ?? videoLanguage(app);
    final seen = watchedVideos(app);
    final first = explainers.first;
    return ListView(
      padding: widget.padding,
      children: [
        ?widget.header,
        Text(
          VideoWords.pickLanguage.of(lang),
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: Brand.text),
        ),
        const SizedBox(height: 8),
        LanguagePicker(
          lang: lang,
          onPick: (l) async {
            setState(() => _lang = l);
            await _saveVideos(app, lang: l);
          },
        ),
        const SizedBox(height: 14),
        // The big first video, playing quietly
        Semantics(
          button: true,
          label: '${VideoWords.watch.of(lang)}: ${first.title.of(lang)}',
          child: Material(
            color: const Color(0xFF0B141A),
            borderRadius: BorderRadius.circular(20),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => _open(first.id),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    height: 200,
                    child: Stack(
                      children: [
                        Positioned.fill(
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(10, 10, 10, 0),
                            child: ExcludeSemantics(
                              child: FittedBox(
                                child: AnimatedBuilder(
                                  animation: _preview,
                                  builder: (context, _) => SceneView(scene: first.scenes[2], t: MediaQuery.disableAnimationsOf(context) ? 1 : _preview.value, lang: lang),
                                ),
                              ),
                            ),
                          ),
                        ),
                        Center(
                          child: Container(
                            width: 62,
                            height: 62,
                            decoration: BoxDecoration(
                              color: Brand.green,
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 3),
                            ),
                            child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 38),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                first.title.of(lang),
                                style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700, height: 1.25),
                              ),
                              const SizedBox(height: 3),
                              Text(first.summary.of(lang), style: const TextStyle(color: Color(0xBFFFFFFF), fontSize: 13, height: 1.35)),
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        _Length(seconds: first.seconds, lang: lang, seen: seen.contains(first.id), dark: true),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        for (final ex in explainers.skip(1)) ...[
          Material(
            color: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: const BorderSide(color: Brand.line),
            ),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => _open(ex.id),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(color: Brand.blue, borderRadius: BorderRadius.circular(14)),
                          child: Icon(ex.icon, color: Colors.white, size: 26),
                        ),
                        Positioned(
                          right: -4,
                          bottom: -4,
                          child: Container(
                            width: 22,
                            height: 22,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                              border: Border.all(color: Brand.line),
                            ),
                            child: const Icon(Icons.play_arrow_rounded, size: 16, color: Brand.blue),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            ex.title.of(lang),
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: Brand.text, height: 1.25),
                          ),
                          const SizedBox(height: 3),
                          Text(ex.summary.of(lang), style: const TextStyle(color: Brand.muted, fontSize: 13, height: 1.3)),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    _Length(seconds: ex.seconds, lang: lang, seen: seen.contains(ex.id)),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

/// "28 sec", or a tick when watched.
class _Length extends StatelessWidget {
  const _Length({required this.seconds, required this.lang, required this.seen, this.dark = false});
  final int seconds;
  final String lang;
  final bool seen;
  final bool dark;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(color: seen ? Brand.bubble : (dark ? const Color(0x26FFFFFF) : Brand.page), borderRadius: BorderRadius.circular(99)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(seen ? Icons.check_circle : Icons.schedule, size: 13, color: seen ? Brand.blue : (dark ? Colors.white : Brand.muted)),
        const SizedBox(width: 4),
        Text(
          seen ? VideoWords.watched.of(lang) : '$seconds ${VideoWords.seconds.of(lang)}',
          style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: seen ? const Color(0xFF15603E) : (dark ? Colors.white : Brand.muted)),
        ),
      ],
    ),
  );
}
