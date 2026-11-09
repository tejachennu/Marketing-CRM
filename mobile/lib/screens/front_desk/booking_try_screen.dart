import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import 'booking_steps.dart';
import 'logic.dart';

/// Try the booking flow as a customer: the same steps, words, buttons and lists the customer gets
/// on WhatsApp, with your services, team and opening hours. Nothing is sent or booked.
class BookingTryScreen extends StatefulWidget {
  const BookingTryScreen({super.key, required this.steps, required this.welcome, required this.trigger, required this.multiSelect, required this.autoApprove, this.daysAhead = 7});
  final List<Map<String, dynamic>> steps;
  final String welcome, trigger;
  final bool multiSelect, autoApprove;
  final int daysAhead;
  @override
  State<BookingTryScreen> createState() => _BookingTryScreenState();
}

/// One message in the chat: the customer's, the business's words, a list or buttons, or a photo / link / map.
class _Msg {
  _Msg.mine(this.text) : mine = true, button = null, rows = const [], notes = const [], media = null, onTap = null;
  _Msg.says(this.text) : mine = false, button = null, rows = const [], notes = const [], media = null, onTap = null;
  _Msg.list(this.text, this.button, this.rows, this.onTap, {this.notes = const []}) : mine = false, media = null;
  _Msg.media(this.media) : mine = false, text = '', button = null, rows = const [], notes = const [], onTap = null;
  final bool mine;
  final String text;
  final String? button;
  final List<String> rows, notes;
  final Widget? media;
  final void Function(int)? onTap;
}

class _BookingTryScreenState extends State<BookingTryScreen> {
  final List<_Msg> _chat = [];
  final _input = TextEditingController();
  final _scroll = ScrollController();
  int _step = 0;
  final List<Map<String, dynamic>> _picked = [];
  Map<String, dynamic>? _who;
  final List<String> _answers = [];
  bool _typing = false; // waiting for a typed answer
  bool _done = false;

  late FrontDesk _desk;
  List<Map<String, dynamic>> get _services => _desk.services.where((s) => s['active'] != false).toList();
  String get _names => _picked.map((s) => s['name']).join(', ');
  String _words(Map<String, dynamic> s) => stepWords(s, name: 'Priya', business: _desk.businessName, service: _names);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  void _start() {
    _desk = FrontDesk(AppScope.read(context));
    setState(() {
      _chat.clear();
      _step = 0;
      _picked.clear();
      _who = null;
      _answers.clear();
      _typing = false;
      _done = false;
      _chat.add(_Msg.mine(widget.trigger.isEmpty ? 'Book' : widget.trigger[0].toUpperCase() + widget.trigger.substring(1)));
    });
    if (_services.isEmpty) return _say('Bookings are not open on WhatsApp yet. Please call us to book. (Add services in Setup first.)');
    _run(widget.welcome.replaceAll('{name}', 'Priya').replaceAll('{business}', _desk.businessName));
  }

  void _say(String text) => setState(() => _chat.add(_Msg.says(text)));

  void _add(_Msg m) {
    setState(() => _chat.add(m));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  void _next() {
    _step++;
    _run();
  }

  void _run([String? intro]) {
    String withIntro(String text) => intro == null || intro.isEmpty ? text : '$intro\n\n$text';
    if (_step >= widget.steps.length) return;
    final s = widget.steps[_step];
    switch (s['type']) {
      case 'message':
        _add(_Msg.says(withIntro(_words(s))));
        return _next();
      case 'image' || 'link' || 'location':
        if (intro != null && intro.isNotEmpty) _add(_Msg.says(intro));
        if (s['type'] == 'image') _add(_Msg.media(MediaBubble.photo(url: '${s['url'] ?? ''}', text: _words(s))));
        if (s['type'] == 'link') _add(_Msg.media(MediaBubble.link(text: _words(s), button: '${s['button'] ?? ''}'.trim().isEmpty ? 'Open' : '${s['button']}')));
        if (s['type'] == 'location') {
          if ('${s['text'] ?? ''}'.trim().isNotEmpty) _add(_Msg.says(_words(s)));
          _add(_Msg.media(MediaBubble.map(place: '${s['name'] ?? ''}', address: '${s['address'] ?? ''}', pin: mapsCoordinates('${s['url'] ?? ''}') != null || s['latitude'] is num)));
        }
        return _next();
      case 'text':
        _add(_Msg.says(withIntro('${_words(s)}\n(Type your answer, or "cancel" to stop.)')));
        setState(() => _typing = true);
        return;
      case 'choice':
        final options = [for (final o in (s['options'] as List? ?? const [])) '$o'];
        _add(
          _Msg.list(withIntro(_words(s)), options.length <= 3 ? '' : 'Choose', options, (i) {
            _add(_Msg.mine(options[i]));
            _answers.add('${'${s['label'] ?? ''}'.trim().isEmpty ? 'Answer' : s['label']}: ${options[i]}');
            _next();
          }),
        );
        return;
      case 'services':
        final own = '${s['text'] ?? ''}'.trim();
        final body = _picked.isNotEmpty
            ? withIntro('Which other service would you like? (You have: $_names)')
            : (intro != null && intro.trim().endsWith('?') && own.isEmpty ? intro : withIntro(_words(s)));
        return _servicesList(body);
      case 'staff':
        final ids = _picked.map((x) => x['id']).toSet();
        final people = _desk.staff.where((m) {
          final does = (m['service_ids'] as List? ?? const []);
          return m['active'] != false && (does.isEmpty || ids.every(does.contains));
        }).toList();
        if (people.length <= 1) return _next();
        final rows = ['Anyone free', ...people.take(9).map((m) => '${m['name']}')];
        _add(
          _Msg.list(withIntro(_words(s)), 'Choose who', rows, (i) {
            _add(_Msg.mine(rows[i]));
            _who = i == 0 ? null : people[i - 1];
            _next();
          }),
        );
        return;
      default:
        return _days(withIntro(_words(s)));
    }
  }

  void _servicesList(String body) {
    final left = _services.where((sv) => !_picked.any((p) => p['id'] == sv['id'])).toList();
    void pick(Map<String, dynamic> sv) {
      _add(_Msg.mine('${sv['name']}'));
      _picked.add(sv);
      final more = left.length > 1 && _picked.length < 5;
      if (!widget.multiSelect || !more) return _next();
      final next = _step + 1 < widget.steps.length && widget.steps[_step + 1]['type'] == 'datetime' ? 'Choose a day' : 'Continue';
      final total = _picked.fold<num>(0, (t, x) => t + (num.tryParse('${x['price']}') ?? 0));
      final minutes = _picked.fold<num>(0, (t, x) => t + ((x['duration_minutes'] as num?) ?? 30));
      _add(
        _Msg.list('Added: ${sv['name']}.\nSo far: $_names · ${formatRupees(total)}, about $minutes min.\n\nWould you like another service?', '', ['Add another', next], (i) {
          _add(_Msg.mine(i == 0 ? 'Add another' : next));
          if (i == 0) return _servicesList('Which other service would you like? (You have: $_names)');
          _next();
        }),
      );
    }

    if (left.length <= 10) {
      _add(
        _Msg.list(
          body,
          'Choose a service',
          [for (final sv in left) '${sv['name']}'],
          (i) => pick(left[i]),
          notes: [for (final sv in left) '${formatRupees(sv['price'])} · ${sv['duration_minutes']} min'],
        ),
      );
      return;
    }
    // More than 10: a category first
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final sv in left) {
      groups.putIfAbsent('${sv['category'] ?? 'General'}', () => []).add(sv);
    }
    final names = groups.keys.take(10).toList();
    _add(
      _Msg.list(body, 'Choose a category', names, (i) {
        _add(_Msg.mine(names[i]));
        final inGroup = groups[names[i]]!.take(10).toList();
        _add(
          _Msg.list(
            'Which ${names[i]} service would you like?',
            'Choose a service',
            [for (final sv in inGroup) '${sv['name']}'],
            (k) => pick(inGroup[k]),
            notes: [for (final sv in inGroup) '${formatRupees(sv['price'])} · ${sv['duration_minutes']} min'],
          ),
        );
      }, notes: [for (final n in names) '${groups[n]!.length} services']),
    );
  }

  /// Open days ahead, from the opening hours and closed days in Setup.
  void _days(String body) {
    final settings = _desk.settings;
    final closed = [for (final d in (settings['closed_weekdays'] as List? ?? const [])) (d as num).toInt()];
    final today = istNow();
    final days = <DateTime>[];
    for (var i = 0; i < widget.daysAhead && days.length < 10; i++) {
      final d = DateTime(today.year, today.month, today.day).add(Duration(days: i));
      if (!closed.contains(d.weekday % 7)) days.add(d);
    }
    String title(DateTime d) {
      final diff = d.difference(DateTime(today.year, today.month, today.day)).inDays;
      return diff == 0 ? 'Today' : (diff == 1 ? 'Tomorrow' : DateFormat('EEE, d MMM').format(d));
    }

    if (days.isEmpty) return _say('Sorry, there are no free times in the next ${widget.daysAhead} days. Please call us and we will fit you in.');
    _add(
      _Msg.list(body, 'Choose a day', [for (final d in days) title(d)], (i) {
        _add(_Msg.mine(title(days[i])));
        _times(days[i], title(days[i]));
      }, notes: [for (final d in days) title(d).startsWith('T') ? DateFormat('EEE, d MMM').format(d) : '']),
    );
  }

  void _times(DateTime day, String dayTitle) {
    int minutes(String? hhmm, int fallback) {
      final p = (hhmm ?? '').split(':');
      return p.length < 2 ? fallback : (int.tryParse(p[0]) ?? 0) * 60 + (int.tryParse(p[1]) ?? 0);
    }

    final opens = minutes(_desk.settings['opens_at'] as String?, 600), closes = minutes(_desk.settings['closes_at'] as String?, 1260);
    final length = _picked.fold<int>(0, (t, x) => t + ((x['duration_minutes'] as num?)?.toInt() ?? 30));
    final now = istNow();
    final isToday = day.year == now.year && day.month == now.month && day.day == now.day;
    final times = <String>[];
    for (var m = opens; m + length <= closes && times.length < 10; m += 30) {
      if (isToday && m <= now.hour * 60 + now.minute + 30) continue;
      times.add(DateFormat('h:mm a').format(DateTime(2000, 1, 1, m ~/ 60, m % 60)).toLowerCase());
    }
    if (times.isEmpty) {
      _say('Sorry, $dayTitle just filled up. Please choose another day.');
      return _days('Which day suits you for $_names?');
    }
    _add(
      _Msg.list('$_names on $dayTitle: tap "Choose a time" to pick one.', 'Choose a time', times, (i) {
        _add(_Msg.mine(times[i]));
        final who = _who == null ? '' : ' with ${_who!['name']}';
        _say(
          widget.autoApprove
              ? 'Confirmed! $_names$who at ${_desk.businessName}, $dayTitle at ${times[i]}. See you soon! ✨'
              : 'Thank you! We have your request for $_names$who on $dayTitle at ${times[i]}. We will confirm it shortly.',
        );
        setState(() => _done = true);
      }),
    );
  }

  void _send() {
    final text = _input.text.trim();
    if (text.isEmpty || !_typing) return;
    _input.clear();
    _add(_Msg.mine(text));
    setState(() => _typing = false);
    if (text.toLowerCase() == 'cancel') {
      _say('Booking cancelled. Send "Book" any time to start again.');
      setState(() => _done = true);
      return;
    }
    final s = widget.steps[_step];
    _answers.add('${'${s['label'] ?? ''}'.trim().isEmpty ? 'Answer' : s['label']}: $text');
    _next();
  }

  @override
  Widget build(BuildContext context) {
    final lastTap = _chat.lastIndexWhere((m) => m.onTap != null);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Try it as a customer'),
        actions: [IconButton(tooltip: 'Start again', onPressed: _start, icon: const Icon(Icons.restart_alt))],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: Brand.blueSoft,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: const Text(
              'A test: tap the buttons and lists like a customer. Nothing is sent or booked.',
              style: TextStyle(fontSize: 12.5, color: Brand.navy, fontWeight: FontWeight.w600),
            ),
          ),
          Expanded(
            child: Container(
              color: const Color(0xFFEFEAE2),
              child: ListView(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                children: [
                  for (var i = 0; i < _chat.length; i++)
                    if (_chat[i].media != null)
                      _chat[i].media!
                    else if (_chat[i].onTap != null)
                      ListBubble(
                        text: _chat[i].text,
                        button: _chat[i].button ?? '',
                        rows: _chat[i].rows,
                        notes: _chat[i].notes,
                        // Only the newest list answers, like WhatsApp lists from an earlier step
                        onTap: i == lastTap && !_done && !_typing ? _chat[i].onTap : null,
                      )
                    else
                      ChatBubble(text: _chat[i].text, mine: _chat[i].mine),
                  if (_done) ...[
                    const SizedBox(height: 14),
                    if (_answers.isNotEmpty)
                      Center(
                        child: Text(
                          'Saved on the booking: ${_answers.join(' · ')}',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 12.5, color: Brand.textSoft),
                        ),
                      ),
                    const SizedBox(height: 8),
                    Center(
                      child: FilledButton.icon(onPressed: _start, icon: const Icon(Icons.restart_alt), label: const Text('Try again')),
                    ),
                  ],
                ],
              ),
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
              color: Colors.white,
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      enabled: _typing,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(hintText: _typing ? 'Type your answer' : 'Tap a button or list above', isDense: true),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(onPressed: _typing ? _send : null, icon: const Icon(Icons.send)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
