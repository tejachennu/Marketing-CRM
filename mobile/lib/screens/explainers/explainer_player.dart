import 'dart:math' as math;
import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import 'explainer_content.dart';
import 'explainer_scenes.dart';
import 'narrator.dart';

/// The explainer videos: a player that feels like a story (bars on top, tap the right side for the next scene, the
/// left for the one before, tap the middle to pause), with the words under the picture in English, Telugu or Hindi.
/// The language and what was watched are kept on the phone ('videos').

/// Telugu and Hindi are shown only in India (owner: "if the app opened outside of India don't show Hindi and
/// Telugu"). Signed in: the workspace's currency says where the business is. Before that: the phone's country or
/// language, or India's time zone (+5:30; many Indian phones are set to "English (United States)").
bool indianLanguagesOn(AppState app) {
  final currency = '${(app.me?['organization'] as Map?)?['currency'] ?? ''}'.toUpperCase();
  if (currency.isNotEmpty) return currency == 'INR';
  final phone = PlatformDispatcher.instance.locale;
  if (phone.countryCode == 'IN' || phone.languageCode == 'te' || phone.languageCode == 'hi') return true;
  return DateTime.now().timeZoneOffset == const Duration(hours: 5, minutes: 30);
}

/// The scenes of [ex] for this phone: outside India, the scene showing Telugu and Hinglish replies is left out.
List<Scene> scenesFor(Explainer ex, bool india) => india
    ? ex.scenes
    : [
        for (final s in ex.scenes)
          if (s.kind != SceneKind.languages) s,
      ];

int secondsFor(Explainer ex, bool india) => (scenesFor(ex, india).fold<int>(0, (sum, s) => sum + s.ms) / 1000).round();

/// The language the videos play in: English outside India; in India the one picked before, else the phone's
/// (Telugu / Hindi), else English.
String videoLanguage(AppState app) {
  if (!indianLanguagesOn(app)) return 'en';
  final saved = '${app.store.read('videos')?['lang'] ?? ''}';
  if (videoLanguages.any((l) => l.$1 == saved)) return saved;
  final phone = PlatformDispatcher.instance.locale.languageCode;
  return videoLanguages.any((l) => l.$1 == phone) ? phone : 'en';
}

/// The voice reads the scenes unless it was switched off (kept on the phone).
bool videoSound(AppState app) => app.store.read('videos')?['sound'] != false;

Future<void> _saveVideos(AppState app, {String? lang, String? watched, bool? sound}) async {
  final old = app.store.read('videos') ?? const {};
  final seen = {...((old['watched'] as List?) ?? const []).map((e) => '$e')};
  if (watched != null) seen.add(watched);
  // No language picked yet: keep none, so the phone's language still counts (videoLanguage)
  await app.store.write('videos', {'lang': lang ?? old['lang'], 'watched': seen.toList(), 'sound': sound ?? old['sound'] ?? true});
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
  const ExplainerScreen({super.key, required this.startId, this.autoplay = true, this.startScene = 0, this.holdAt, this.lang, this.showEnd = false});
  final String startId;

  /// Tests and screenshots: hold still on the first scene.
  final bool autoplay;

  /// Screenshots: open on this scene, held still at this point of it (0 → 1), in this language.
  final int startScene;
  final double? holdAt;
  final String? lang;

  /// Screenshots and layout checks: open on the screen shown after the video.
  final bool showEnd;
  @override
  State<ExplainerScreen> createState() => _ExplainerScreenState();
}

class _ExplainerScreenState extends State<ExplainerScreen> with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late int _video = explainers.indexWhere((e) => e.id == widget.startId).clamp(0, explainers.length - 1);
  // In India or not: outside it there is no Telugu / Hindi, and the scene showing them is left out
  late final bool _india = indianLanguagesOn(AppScope.read(context));
  late int _scene = widget.startScene.clamp(0, scenesFor(explainers[_video], _india).length - 1);
  bool _paused = false;
  late bool _ended = widget.showEnd;
  late String? _lang = widget.lang;
  late final AnimationController _clock = AnimationController(vsync: this)..addStatusListener(_onStatus);

  // The voice (narrator.dart): a scene moves on when its picture has played and its words have been read
  late bool _sound = videoSound(AppScope.read(context));
  int _voiceTurn = 0;
  bool _voiceDone = true;
  bool _waitingForVoice = false;
  // The language this phone has no voice for (a note says how to add one)
  String? _noVoice;

  Explainer get _ex => explainers[_video];
  List<Scene> get _scenes => scenesFor(_ex, _india);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // The clips' lengths, so each scene lasts as long as its words
    narrator.warmUp().then((_) {
      if (!mounted || _ended) return;
      // The first scene started before the lengths were known: it now lasts as long as its words
      _clock.duration = _sceneLength();
      if (_clock.isAnimating) _clock.forward();
    });
    // Screen readers: start paused, so the words are not swapped while they are being read
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && MediaQuery.accessibleNavigationOf(context) && !_paused) _togglePause();
    });
    _startScene();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _hush();
    _clock.dispose();
    super.dispose();
  }

  String get _speakingLang => _lang ?? videoLanguage(AppScope.read(context));

  /// Stops the voice; a reading still under way is forgotten.
  void _hush() {
    _voiceTurn++;
    _voiceDone = true;
    narrator.stop();
  }

  /// Reads the current scene's words from the start (when the sound is on and the video is playing).
  Future<void> _speakScene() async {
    final turn = ++_voiceTurn;
    await narrator.stop();
    if (!mounted || turn != _voiceTurn) return;
    if (!_sound || _paused || _ended || !widget.autoplay || widget.holdAt != null) {
      _voiceDone = true;
      if (_waitingForVoice && !_paused) _advance();
      return;
    }
    final lang = _speakingLang;
    _voiceDone = false;
    final can = await narrator.canSpeak(lang);
    if (!mounted || turn != _voiceTurn) return;
    if (!can) {
      setState(() => _noVoice = lang);
      _voiceDone = true;
      if (_waitingForVoice && !_paused) _advance();
      return;
    }
    if (_noVoice != null) setState(() => _noVoice = null);
    await narrator.say(spokenWords(_scenes[_scene], lang), lang);
    if (!mounted || turn != _voiceTurn) return;
    _voiceDone = true;
    // A short breath after the words before the next scene
    if (_waitingForVoice) await Future<void>.delayed(const Duration(milliseconds: 250));
    if (mounted && turn == _voiceTurn && _waitingForVoice && !_paused) _advance();
  }

  Future<void> _toggleSound() async {
    final app = AppScope.read(context);
    setState(() => _sound = !_sound);
    // The voice stops (or starts) at once; the choice is saved after
    if (_sound) {
      _speakScene();
    } else {
      _hush();
      setState(() => _noVoice = null);
      if (_waitingForVoice && !_paused) _advance();
    }
    await _saveVideos(app, sound: _sound);
  }

  /// Leaving the app pauses the video (otherwise the time away would count and skip scenes)
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && !_paused && !_ended) _togglePause();
  }

  void _startScene() {
    _waitingForVoice = false;
    _clock.duration = _sceneLength();
    _clock.value = widget.holdAt ?? 0;
    if (widget.autoplay && widget.holdAt == null && !_paused) _clock.forward();
    _speakScene();
  }

  /// With a recorded voice a scene lasts as long as its words and a short breath, so the voice flows with no gaps;
  /// otherwise its own length.
  Duration _sceneLength() {
    final scene = _scenes[_scene];
    final lang = _speakingLang;
    final voice = _sound && widget.holdAt == null ? narrator.lengthMs(spokenWords(scene, lang), lang) : null;
    return Duration(milliseconds: voice != null ? math.max(2500, voice + 250) : scene.ms);
  }

  void _onStatus(AnimationStatus status) {
    if (status != AnimationStatus.completed) return;
    // The picture is done; the words may still be being read
    if (!_voiceDone) {
      _waitingForVoice = true;
      return;
    }
    _advance();
  }

  void _advance() {
    _waitingForVoice = false;
    if (_ended) return;
    if (_scene < _scenes.length - 1) {
      setState(() => _scene++);
      _startScene();
    } else {
      _finish();
    }
  }

  void _finish() {
    _hush();
    final app = AppScope.read(context);
    _saveVideos(app, watched: _ex.id);
    setState(() => _ended = true);
  }

  void _go(int delta) {
    if (_ended) return;
    final next = _scene + delta;
    if (next < 0) {
      // Back on the first scene: play it (and read it) again from the start
      _startScene();
      return;
    }
    if (next >= _scenes.length) return _finish();
    setState(() => _scene = next);
    _startScene();
  }

  void _togglePause() {
    if (_ended) return;
    setState(() => _paused = !_paused);
    if (_paused) {
      _clock.stop();
      _hush();
    } else {
      _clock.forward();
      // The words start again from the top of the scene
      _speakScene();
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
    setState(() {
      _lang = lang;
      _noVoice = null;
    });
    await _saveVideos(AppScope.read(context), lang: lang);
    // Read this scene again in the new language
    if (mounted && !_ended) _speakScene();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final lang = _lang ?? videoLanguage(app);
    final still = MediaQuery.disableAnimationsOf(context);
    final scene = _scenes[_scene];
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
                  label: '${_scene + 1} / ${_scenes.length}',
                  child: ExcludeSemantics(
                    child: AnimatedBuilder(
                      animation: _clock,
                      builder: (context, _) => Row(
                        children: [
                          for (var i = 0; i < _scenes.length; i++) ...[
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
                      onPressed: _toggleSound,
                      tooltip: _sound ? VideoWords.soundOff.of(lang) : VideoWords.soundOn.of(lang),
                      icon: Icon(_sound ? Icons.volume_up_rounded : Icons.volume_off_rounded, color: Colors.white),
                    ),
                    IconButton(
                      onPressed: () => Navigator.maybePop(context),
                      tooltip: VideoWords.close.of(lang),
                      icon: const Icon(Icons.close, color: Colors.white),
                    ),
                  ],
                ),
              ),
              if (_india)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                  child: LanguagePicker(lang: lang, onPick: _setLang, dark: true),
                )
              else
                const SizedBox(height: 8),
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
              if (!_ended && _sound && _noVoice == lang)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 2, 20, 2),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Padding(padding: EdgeInsets.only(top: 1, right: 8), child: Icon(Icons.volume_off_rounded, color: Color(0xB3FFFFFF), size: 17)),
                      Expanded(child: Text(VideoWords.noVoice.of(lang), style: const TextStyle(color: Color(0xB3FFFFFF), fontSize: 12.5, height: 1.35))),
                    ],
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

  /// After the last scene: what was said, the next video with a moving preview, the website card ("customers from
  /// every side"), and every video with a tick for the watched ones.
  Widget _endView(String lang) {
    final app = AppScope.of(context);
    final next = _video + 1 < explainers.length ? _video + 1 : null;
    final website = explainers.indexWhere((e) => e.id == 'website');
    final watched = {...watchedVideos(app), _ex.id};
    const card = Color(0xFF1F2C34);
    const soft = Color(0xB3FFFFFF);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        // What this video said
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: const BoxDecoration(color: Brand.green, shape: BoxShape.circle),
              child: const Icon(Icons.check_rounded, color: Colors.white, size: 28),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    VideoWords.videoDone.of(lang).toUpperCase(),
                    style: const TextStyle(color: Brand.green, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _scenes.last.title.of(lang),
                    style: const TextStyle(color: Colors.white, fontSize: 21, fontWeight: FontWeight.w700, height: 1.25),
                  ),
                  const SizedBox(height: 4),
                  Text(_scenes.last.line.of(lang), style: const TextStyle(color: soft, fontSize: 14.5, height: 1.4)),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 18),
        // Up next, with its picture moving
        if (next != null) ...[
          Material(
            color: card,
            borderRadius: BorderRadius.circular(18),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => _playVideo(next),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: SizedBox(
                        width: 92,
                        height: 108,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            ExcludeSemantics(
                              child: FittedBox(
                                fit: BoxFit.cover,
                                child: SceneView(scene: scenesFor(explainers[next], _india).first, t: 0.85, lang: lang),
                              ),
                            ),
                            const ColoredBox(color: Color(0x33000000)),
                            const Center(child: Icon(Icons.play_circle_fill_rounded, color: Colors.white, size: 38)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            VideoWords.upNext.of(lang).toUpperCase(),
                            style: const TextStyle(color: Brand.green, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.6),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            explainers[next].title.of(lang),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700, height: 1.25),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${secondsFor(explainers[next], _india)} ${VideoWords.seconds.of(lang)}',
                            style: const TextStyle(color: soft, fontSize: 12.5),
                          ),
                          const SizedBox(height: 8),
                          FilledButton.icon(
                            onPressed: () => _playVideo(next),
                            style: FilledButton.styleFrom(
                              backgroundColor: Brand.green,
                              foregroundColor: const Color(0xFF0B141A),
                              minimumSize: const Size(0, 40),
                              padding: const EdgeInsets.symmetric(horizontal: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                            icon: const Icon(Icons.play_arrow_rounded, size: 20),
                            label: Text(VideoWords.next.of(lang), maxLines: 1, overflow: TextOverflow.ellipsis),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
        ],
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _playVideo(_video),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Color(0x66FFFFFF)),
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                icon: const Icon(Icons.replay, size: 20),
                label: Text(VideoWords.again.of(lang), maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton(
                onPressed: () => Navigator.maybePop(context),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Color(0x66FFFFFF)),
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: Text(VideoWords.done.of(lang), maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            ),
          ],
        ),
        const SizedBox(height: 22),
        // We also give the business its own website: customers from every side
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: card, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0x3325D366))),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(color: Brand.blue, borderRadius: BorderRadius.circular(11)),
                    child: const Icon(Icons.language, color: Colors.white, size: 21),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      VideoWords.everySide.of(lang),
                      style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700, height: 1.25),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(VideoWords.everySideLine.of(lang), style: const TextStyle(color: soft, fontSize: 14, height: 1.45)),
              const SizedBox(height: 12),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  for (final (icon, label) in [
                    (Icons.search, 'Google'),
                    (Icons.camera_alt_outlined, 'Instagram'),
                    (Icons.chat_outlined, 'WhatsApp'),
                    (Icons.campaign_outlined, _adsWord.of(lang)),
                  ])
                    _Pill(icon: icon, label: label),
                  const Icon(Icons.arrow_forward_rounded, color: soft, size: 18),
                  _Pill(icon: Icons.language, label: VideoWords.yourWebsite.of(lang), colour: Brand.blue),
                  const Icon(Icons.arrow_forward_rounded, color: soft, size: 18),
                  _Pill(icon: Icons.trending_up, label: VideoWords.moreSales.of(lang), colour: Brand.green, dark: true),
                ],
              ),
              if (website >= 0 && website != _video) ...[
                const SizedBox(height: 12),
                TextButton.icon(
                  onPressed: () => _playVideo(website),
                  style: TextButton.styleFrom(foregroundColor: Brand.green, padding: EdgeInsets.zero, minimumSize: const Size(0, 40)),
                  icon: const Icon(Icons.play_circle_outline_rounded, size: 20),
                  label: Text('${VideoWords.watch.of(lang)}: ${explainers[website].title.of(lang)}'),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 22),
        Text(VideoWords.allVideos.of(lang), style: const TextStyle(color: Colors.white, fontSize: 15.5, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        for (final (i, ex) in explainers.indexed)
          InkWell(
            onTap: () => _playVideo(i),
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: i == _video ? Brand.green : card, borderRadius: BorderRadius.circular(11)),
                    child: Icon(ex.icon, color: i == _video ? const Color(0xFF0B141A) : Colors.white, size: 21),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          ex.title.of(lang),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Colors.white, fontSize: 14.5, fontWeight: FontWeight.w600, height: 1.25),
                        ),
                        Text('${secondsFor(ex, _india)} ${VideoWords.seconds.of(lang)}', style: const TextStyle(color: soft, fontSize: 12.5)),
                      ],
                    ),
                  ),
                  if (watched.contains(ex.id))
                    Tooltip(
                      message: VideoWords.watched.of(lang),
                      child: const Icon(Icons.check_circle_rounded, color: Brand.green, size: 22),
                    )
                  else
                    const Icon(Icons.play_circle_outline_rounded, color: soft, size: 22),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

const _adsWord = Tx('Ads', 'యాడ్స్', 'ऐड');

/// A small rounded label with an icon (the website card on the screen after a video).
class _Pill extends StatelessWidget {
  const _Pill({required this.icon, required this.label, this.colour = const Color(0xFF2A3942), this.dark = false});
  final IconData icon;
  final String label;
  final Color colour;
  final bool dark;
  @override
  Widget build(BuildContext context) {
    final ink = dark ? const Color(0xFF0B141A) : Colors.white;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: colour, borderRadius: BorderRadius.circular(99)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: ink, size: 15),
          const SizedBox(width: 5),
          Text(label, style: TextStyle(color: ink, fontSize: 12.5, fontWeight: FontWeight.w700)),
        ],
      ),
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
    final india = indianLanguagesOn(app);
    return ListView(
      padding: widget.padding,
      children: [
        ?widget.header,
        // The language choice only in India (outside it the videos are in English)
        if (india) ...[
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
        ],
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
                        _Length(seconds: secondsFor(first, india), lang: lang, seen: seen.contains(first.id), dark: true),
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
                    _Length(seconds: secondsFor(ex, india), lang: lang, seen: seen.contains(ex.id)),
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
