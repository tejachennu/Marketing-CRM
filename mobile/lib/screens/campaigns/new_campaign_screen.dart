import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../templates/template_widgets.dart';
import 'audience.dart';

/// Every contact with what a campaign needs (all of them when online, else the ones on the phone).
List<Map<String, dynamic>> campaignContacts(AppState app) {
  final all = app.cached('contacts:all') ?? app.cached('contacts');
  return [for (final c in (all?['contacts'] as List? ?? const [])) Map<String, dynamic>.from(c)];
}

/// What can fill a blank for people from your contacts.
const _contactFields = {'first_name': 'First name', 'full_name': 'Full name', 'company': 'Company', '_fixed': 'Same text for all'};

/// A new campaign, as on the web but on one page: the message, who gets it (your contacts, with
/// filters and ticks, or a list you upload), what fills each blank, which number sends it, and when.
/// Made offline, it waits on the phone and is created and sent once online.
class NewCampaignScreen extends StatefulWidget {
  const NewCampaignScreen({super.key});
  @override
  State<NewCampaignScreen> createState() => _NewCampaignScreenState();
}

class _NewCampaignScreenState extends State<NewCampaignScreen> {
  final _name = TextEditingController();
  Map<String, dynamic>? _template;

  // Who gets it
  bool _fromSheet = false;
  Set<String>? _picked; // contact ids; null = everyone with a number
  AudienceFilter _filter = const AudienceFilter();
  SheetData? _sheet;
  String? _sheetName;
  String? _phoneColumn;
  String? _nameColumn;
  final _sheetTag = TextEditingController();

  // Blanks: for contacts a field from _contactFields, for a sheet a column name; '_fixed' = same text
  final Map<String, String> _source = {};
  final Map<String, TextEditingController> _fixed = {};

  // Sending
  List<Map<String, dynamic>> _senders = const [];
  String? _sender;
  int _when = 0; // 0 now, 1 today 6 pm, 2 tomorrow 10 am, 3 picked
  DateTime? _pickedAt; // UTC
  bool _tried = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final app = AppScope.read(context);
      if (!app.online) return;
      app.load('contacts:all', '/api/contacts', query: {'all': 'true', 'fields': 'basic'}, force: true);
      app.load('campaigns:all', '/api/campaigns', query: {'all': 'true'}, force: true);
      try {
        final s = await app.backend.get('/api/campaigns/senders', {'organizationId': app.orgId});
        final list = [for (final x in (s['whatsappSenders'] as List? ?? const [])) Map<String, dynamic>.from(x)];
        if (mounted && list.isNotEmpty) {
          setState(() {
            _senders = list;
            _sender ??= '${list.first['value']}';
          });
        }
      } catch (_) {
        // The server picks the business number when none is given
      }
    });
  }

  @override
  void dispose() {
    _name.dispose();
    _sheetTag.dispose();
    for (final c in _fixed.values) {
      c.dispose();
    }
    super.dispose();
  }

  DateTime? get _scheduledAt {
    final now = istNow();
    return switch (_when) {
      1 => fromIst(now, 18, 0),
      2 => fromIst(now.add(const Duration(days: 1)), 10, 0),
      3 => _pickedAt,
      _ => null,
    };
  }

  TemplateParts? get _parts => _template == null ? null : TemplateParts(_template!);

  void _pickTemplate(Map<String, dynamic> t) {
    setState(() {
      _template = t;
      _source.clear();
      for (final b in TemplateParts(t).blanks) {
        _source[b] = b == TemplateParts(t).blanks.first ? (_fromSheet ? (_nameColumn ?? '_fixed') : 'first_name') : '_fixed';
        _fixed.putIfAbsent(b, () => TextEditingController());
      }
    });
  }

  List<Map<String, dynamic>> _chosenContacts(AppState app) {
    final all = campaignContacts(app).where((c) => c['_waiting'] != true).toList();
    final picked = _picked;
    return picked == null ? all.where((c) => phoneDigits(c['phone_number']).isNotEmpty).toList() : all.where((c) => picked.contains('${c['id']}')).toList();
  }

  String _value(String blank, {Map<String, dynamic>? contact, Map<String, String>? row}) {
    final src = _source[blank] ?? '_fixed';
    if (src == '_fixed') return _fixed[blank]?.text.trim() ?? '';
    if (row != null) return (row[src] ?? '').trim();
    final c = contact ?? const {};
    return switch (src) {
      'first_name' => '${c['first_name'] ?? ''}'.trim().isNotEmpty ? '${c['first_name']}'.trim() : contactName(c).split(' ').first,
      'full_name' => contactName(c),
      _ => '${c[src] ?? ''}'.trim(),
    };
  }

  RecipientList _recipients(AppState app) {
    final blanks = _parts?.blanks ?? const <String>[];
    if (_fromSheet) {
      final sheet = _sheet;
      if (sheet == null || _phoneColumn == null) return RecipientList(const [], 0, 0);
      return buildRecipients(
        sheet.rows.map((r) {
          final vars = {for (final b in blanks) b: _value(b, row: r)};
          final name = _nameColumn == null ? '' : (r[_nameColumn] ?? '').trim();
          if (name.isNotEmpty) {
            final parts = name.split(RegExp(r'\s+'));
            vars['first_name'] = parts.first;
            vars['contact_name'] = name;
            vars['name'] = name;
            if (parts.length > 1) vars['last_name'] = parts.skip(1).join(' ');
          }
          if (_sheetTag.text.trim().isNotEmpty) {
            vars['tag'] = _sheetTag.text.trim();
            vars['tags'] = _sheetTag.text.trim();
          }
          return (r[_phoneColumn] as Object?, vars);
        }),
      );
    }
    return buildRecipients(_chosenContacts(app).map((c) => (c['phone_number'] as Object?, {for (final b in blanks) b: _value(b, contact: c)})));
  }

  Future<void> _upload() async {
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['csv', 'xlsx']);
    if (file == null) return;
    try {
      final sheet = readSheet(file.name, await file.readAsBytes());
      setState(() {
        _sheet = sheet;
        _sheetName = file.name;
        _phoneColumn = sheet.phoneColumn;
        _nameColumn = sheet.nameColumn;
        // Blanks set to a column of the old file start again
        for (final b in _source.keys.toList()) {
          if (_source[b] != '_fixed' && !sheet.headers.contains(_source[b])) _source[b] = _nameColumn ?? '_fixed';
        }
      });
    } catch (e) {
      if (mounted) toast(context, 'Could not read that file. ${e is FormatException ? e.message : 'Save it as .xlsx or .csv and try again.'}');
    }
  }

  Future<void> _pickTime() async {
    final now = istNow();
    final day = await showDatePicker(context: context, initialDate: now, firstDate: DateTime(now.year, now.month, now.day), lastDate: now.add(const Duration(days: 90)));
    if (day == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: const TimeOfDay(hour: 10, minute: 0), helpText: 'Time in India');
    if (time == null) return;
    setState(() {
      _pickedAt = fromIst(day, time.hour, time.minute);
      _when = 3;
    });
  }

  String? _problem(AppState app, RecipientList list) {
    if (_name.text.trim().isEmpty) return 'Give the campaign a name.';
    if (_template == null) return 'Pick the message to send.';
    if (_fromSheet && _sheet == null) return 'Upload your list, or choose My contacts.';
    if (_fromSheet && _phoneColumn == null) return 'Say which column has the phone numbers.';
    if (list.recipients.isEmpty) return 'Nobody to send to: no one chosen has a usable WhatsApp number.';
    for (final b in _parts!.blanks) {
      if ((_source[b] ?? '_fixed') == '_fixed' && (_fixed[b]?.text.trim() ?? '').isEmpty) return 'Write what goes in blank {{$b}}.';
    }
    if (_when == 3 && (_pickedAt == null || _pickedAt!.isBefore(DateTime.now().toUtc().add(const Duration(minutes: 2))))) return 'Pick a time at least 2 minutes from now.';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final templates = templatesOf(app).where((t) => t['status'] == 'APPROVED').toList();
    final parts = _parts;
    final list = _recipients(app);
    final first = list.recipients.isEmpty ? null : list.recipients.first;
    final problem = _problem(app, list);
    final eveningPassed = istNow().hour >= 18;

    return Scaffold(
      appBar: AppBar(title: const Text('New campaign')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                TextField(
                  controller: _name,
                  textCapitalization: TextCapitalization.sentences,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(labelText: 'Campaign name', hintText: 'Diwali offer', errorText: _tried && _name.text.trim().isEmpty ? 'Give it a name' : null),
                ),

                // ── 1. Message ──
                const _Step(1, 'Message', 'An approved WhatsApp template'),
                if (templates.isEmpty)
                  const Text('No approved templates yet. Make one in More → WhatsApp templates; Meta checks it first.', style: TextStyle(color: Brand.muted))
                else
                  Card(
                    child: Column(
                      children: [
                        for (var i = 0; i < templates.length; i++) ...[
                          if (i > 0) const Divider(indent: 52),
                          ListTile(
                            leading: Icon(_template?['id'] == templates[i]['id'] ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: Brand.blue),
                            title: Text('${templates[i]['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text(TemplateParts(templates[i]).body, maxLines: 2, overflow: TextOverflow.ellipsis),
                            onTap: () => _pickTemplate(templates[i]),
                          ),
                        ],
                      ],
                    ),
                  ),
                if (_tried && _template == null) const _Error('Pick the message to send.'),

                // ── 2. Who gets it ──
                _Step(2, 'Who gets it', '${list.recipients.length} ${list.recipients.length == 1 ? 'person' : 'people'}'),
                SegmentedButton<bool>(
                  showSelectedIcon: false,
                  segments: const [
                    ButtonSegment(value: false, icon: Icon(Icons.people_outline, size: 18), label: Text('My contacts')),
                    ButtonSegment(value: true, icon: Icon(Icons.upload_file, size: 18), label: Text('Upload a list')),
                  ],
                  selected: {_fromSheet},
                  onSelectionChanged: (s) => setState(() {
                    _fromSheet = s.first;
                    for (final b in _source.keys.toList()) {
                      _source[b] = _source[b] == '_fixed' ? '_fixed' : (_fromSheet ? (_nameColumn ?? '_fixed') : 'first_name');
                    }
                  }),
                ),
                const SizedBox(height: 10),
                if (!_fromSheet)
                  Panel(
                    onTap: () async {
                      final result = await Navigator.push<(Set<String>, AudienceFilter)>(
                        context,
                        MaterialPageRoute(
                          builder: (_) => ChoosePeopleScreen(picked: _picked, filter: _filter),
                        ),
                      );
                      if (result != null) {
                        setState(() {
                          _picked = result.$1;
                          _filter = result.$2;
                        });
                      }
                    },
                    child: Row(
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(12)),
                          child: const Icon(Icons.groups_outlined, color: Brand.blue),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(_picked == null ? 'Everyone with a number' : '${_picked!.length} chosen', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                              Text(
                                [
                                  '${list.recipients.length} will get it',
                                  if (list.duplicates > 0) '${list.duplicates} repeated numbers once',
                                  if (list.invalid > 0) '${list.invalid} without a number left out',
                                ].join(' · '),
                                style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                              ),
                            ],
                          ),
                        ),
                        const Text(
                          'Choose',
                          style: TextStyle(color: Brand.blue, fontWeight: FontWeight.w700),
                        ),
                        const Icon(Icons.chevron_right, color: Brand.blue),
                      ],
                    ),
                  )
                else ...[
                  OutlinedButton.icon(
                    onPressed: _upload,
                    icon: const Icon(Icons.upload_file),
                    label: Text(_sheet == null ? 'Choose an Excel or CSV file' : 'Change file · $_sheetName', overflow: TextOverflow.ellipsis),
                  ),
                  const SizedBox(height: 6),
                  if (_sheet == null)
                    const Text('First row: column names, like Name and Phone. One person on each row.', style: TextStyle(fontSize: 12.5, color: Brand.muted))
                  else ...[
                    Text(
                      [
                        '${_sheet!.rows.length} rows',
                        '${list.recipients.length} will get it',
                        if (list.invalid > 0) '${list.invalid} without a usable number',
                        if (list.duplicates > 0) '${list.duplicates} repeated',
                      ].join(' · '),
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: list.invalid > 0 ? Brand.red : Brand.textSoft),
                    ),
                    const SizedBox(height: 10),
                    _ColumnPicker(
                      label: 'Phone number column',
                      value: _phoneColumn,
                      columns: _sheet!.headers,
                      sample: (c) => _sheet!.rows.first[c] ?? '',
                      onChanged: (v) => setState(() => _phoneColumn = v),
                    ),
                    const SizedBox(height: 10),
                    _ColumnPicker(
                      label: 'Name column (optional)',
                      value: _nameColumn,
                      columns: _sheet!.headers,
                      optional: true,
                      sample: (c) => _sheet!.rows.first[c] ?? '',
                      onChanged: (v) => setState(() => _nameColumn = v),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _sheetTag,
                      decoration: const InputDecoration(labelText: 'Tag for these people (optional)', hintText: 'Diwali list'),
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: 4),
                    const Text('They are saved to your contacts with this tag, so you can send to them again.', style: TextStyle(fontSize: 12, color: Brand.muted)),
                  ],
                ],

                // ── 3. Blanks ──
                if (parts != null && parts.blanks.isNotEmpty) ...[
                  const _Step(3, 'Fill the blanks', 'Different for each person, or the same for all'),
                  for (final b in parts.blanks) ...[
                    Text('Blank {{$b}}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    if (_fromSheet && _sheet == null)
                      const Text('Upload the list to use its columns.', style: TextStyle(fontSize: 12.5, color: Brand.muted))
                    else
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          for (final (key, label)
                              in _fromSheet ? [for (final h in _sheet!.headers) (h, h), ('_fixed', 'Same text for all')] : [for (final e in _contactFields.entries) (e.key, e.value)])
                            ChoiceChip(label: Text(label), selected: (_source[b] ?? '_fixed') == key, onSelected: (_) => setState(() => _source[b] = key)),
                        ],
                      ),
                    if ((_source[b] ?? '_fixed') == '_fixed')
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: TextField(
                          controller: _fixed[b],
                          onChanged: (_) => setState(() {}),
                          decoration: InputDecoration(hintText: 'Text for {{$b}}', errorText: _tried && (_fixed[b]?.text.trim() ?? '').isEmpty ? 'Write what goes here' : null),
                        ),
                      ),
                    const SizedBox(height: 12),
                  ],
                ],

                // Preview, with the first person's values
                if (parts != null) ...[
                  SectionLabel(first == null ? 'How it looks' : 'How it looks for the first person'),
                  TemplateBubble(parts: parts, values: first?.variables ?? {for (final b in parts.blanks) b: _value(b)}),
                ],

                // ── 4. Sending ──
                _Step(parts != null && parts.blanks.isNotEmpty ? 4 : 3, 'When', _when == 0 ? (app.online ? 'Right away' : 'As soon as you are online') : 'Scheduled, India time'),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    ChoiceChip(label: Text(app.online ? 'Now' : 'When online'), selected: _when == 0, onSelected: (_) => setState(() => _when = 0)),
                    if (!eveningPassed) ChoiceChip(label: const Text('Today, 6 pm'), selected: _when == 1, onSelected: (_) => setState(() => _when = 1)),
                    ChoiceChip(label: const Text('Tomorrow, 10 am'), selected: _when == 2, onSelected: (_) => setState(() => _when = 2)),
                    ChoiceChip(
                      avatar: Icon(Icons.event, size: 18, color: _when == 3 ? Brand.blue : Brand.textSoft),
                      label: Text(_when == 3 && _pickedAt != null ? DateFormat('d MMM, h:mm a').format(_pickedAt!.add(istOffset)) : 'Pick date and time'),
                      selected: _when == 3,
                      onSelected: (_) => _pickTime(),
                    ),
                  ],
                ),
                if (_senders.length > 1) ...[
                  const SectionLabel('Send from'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final s in _senders)
                        ChoiceChip(label: Text('${s['label'] ?? s['value']}'), selected: _sender == '${s['value']}', onSelected: (_) => setState(() => _sender = '${s['value']}')),
                    ],
                  ),
                ],
                const SizedBox(height: 16),
                const Text(
                  'Only customers who agreed to hear from you should get marketing messages. WhatsApp may limit numbers that get many blocks.',
                  style: TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.4),
                ),
                if (_tried && problem != null) _Error(problem),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Brand.line)),
          ),
          child: FilledButton.icon(
            onPressed: _saving
                ? null
                : () {
                    setState(() => _tried = true);
                    if (problem != null) return toast(context, problem);
                    _create(app, parts!, list);
                  },
            icon: Icon(_when == 0 ? Icons.send : Icons.schedule_send),
            label: Text(_when == 0 ? 'Send to ${list.recipients.length}' : 'Schedule for ${list.recipients.length}'),
          ),
        ),
      ),
    );
  }

  Future<void> _create(AppState app, TemplateParts parts, RecipientList list) async {
    setState(() => _saving = true);
    final localId = AppState.newLocalId();
    final name = _name.text.trim();
    await app.enqueue(
      kind: 'campaign',
      label: 'Campaign "$name" to ${list.recipients.length}',
      path: '/api/campaigns',
      localId: localId,
      resultIdPath: 'campaign.id',
      body: {
        'organizationId': app.orgId,
        'name': name,
        'templateName': _template!['name'],
        'templateBody': parts.body,
        'templateLanguage': _template!['language'] ?? 'en',
        'channel': 'whatsapp',
        'sender': ?_sender,
        'audience': [for (final r in list.recipients) r.toJson()],
        'createdBy': app.me?['user']?['id'],
        if (_scheduledAt != null) 'scheduledAt': _scheduledAt!.toIso8601String(),
      },
    );
    // Sending now: start it once it exists on the server (scheduled ones start on their own)
    if (_scheduledAt == null) {
      await app.enqueue(kind: 'campaign_run', label: 'Start "$name"', path: '/api/campaigns/run', body: {'campaignId': localId});
    }
    if (!mounted) return;
    toast(
      context,
      !app.online
          ? 'Campaign saved. It is created and sent when you are online.'
          : _scheduledAt == null
          ? 'Sending to ${list.recipients.length}.'
          : 'Scheduled.',
    );
    Navigator.pop(context);
  }
}

class _Step extends StatelessWidget {
  const _Step(this.number, this.title, this.hint);
  final int number;
  final String title, hint;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(0, 22, 0, 10),
    child: Row(
      children: [
        Container(
          width: 26,
          height: 26,
          alignment: Alignment.center,
          decoration: const BoxDecoration(color: Brand.navy, shape: BoxShape.circle),
          child: Text(
            '$number',
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              Text(hint, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            ],
          ),
        ),
      ],
    ),
  );
}

class _Error extends StatelessWidget {
  const _Error(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 10),
    child: Text(
      text,
      style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
    ),
  );
}

class _ColumnPicker extends StatelessWidget {
  const _ColumnPicker({required this.label, required this.value, required this.columns, required this.sample, required this.onChanged, this.optional = false});
  final String label;
  final String? value;
  final List<String> columns;
  final String Function(String column) sample;
  final ValueChanged<String?> onChanged;
  final bool optional;
  @override
  Widget build(BuildContext context) => DropdownButtonFormField<String?>(
    key: ValueKey('$label:$value:${columns.join('|')}'),
    initialValue: value,
    isExpanded: true,
    decoration: InputDecoration(labelText: label),
    items: [
      if (optional) const DropdownMenuItem<String?>(value: null, child: Text('None')),
      for (final c in columns)
        DropdownMenuItem<String?>(
          value: c,
          child: Text(sample(c).isEmpty ? c : '$c  ·  ${sample(c)}', overflow: TextOverflow.ellipsis),
        ),
    ],
    onChanged: onChanged,
  );
}

/// Choose who gets a campaign from your contacts: search, tags (any / all / none of them), and
/// past campaigns (got it / did not); then tick or untick. The filters only change the list;
/// the ticks decide who gets it, as on the web.
class ChoosePeopleScreen extends StatefulWidget {
  const ChoosePeopleScreen({super.key, required this.picked, required this.filter});
  final Set<String>? picked;
  final AudienceFilter filter;
  @override
  State<ChoosePeopleScreen> createState() => _ChoosePeopleScreenState();
}

class _ChoosePeopleScreenState extends State<ChoosePeopleScreen> {
  late Set<String>? _picked = widget.picked == null ? null : {...widget.picked!};
  late AudienceFilter _filter = widget.filter;
  final Map<String, List<String>> _participants = {};
  bool _loadingParticipants = false;

  Set<String> _ticked(List<Map<String, dynamic>> all) =>
      _picked ??
      {
        for (final c in all)
          if (phoneDigits(c['phone_number']).isNotEmpty) '${c['id']}',
      };

  Future<void> _needParticipants(Set<String> ids) async {
    final missing = ids.where((id) => !_participants.containsKey(id)).toList();
    if (missing.isEmpty) return;
    final app = AppScope.read(context);
    setState(() => _loadingParticipants = true);
    try {
      final data = await app.backend.get('/api/campaigns/participants', {'organizationId': app.orgId, 'campaignIds': missing.join(',')});
      final by = data['participantsByCampaign'] as Map? ?? const {};
      setState(() {
        for (final id in missing) {
          _participants[id] = [for (final p in (by[id] as List? ?? const [])) '$p'];
        }
      });
    } catch (e) {
      if (mounted) toast(context, 'Could not check who got those campaigns. ${'$e'.replaceFirst('Exception: ', '')}');
      setState(() => _filter = _filter.copyWith(campaignIds: {}));
    } finally {
      if (mounted) setState(() => _loadingParticipants = false);
    }
  }

  Future<void> _tagsSheet(List<(String, int)> tags) async {
    var chosen = {..._filter.tags};
    var mode = _filter.tagMode;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheet) => StatefulBuilder(
        builder: (sheet, set) => SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(sheet).size.height * 0.8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 20),
                  child: Text('Tags', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 10, 20, 6),
                  child: SegmentedButton<TagMode>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: TagMode.any, label: Text('Any of')),
                      ButtonSegment(value: TagMode.all, label: Text('All of')),
                      ButtonSegment(value: TagMode.none, label: Text('None of')),
                    ],
                    selected: {mode},
                    onSelectionChanged: (s) => set(() => mode = s.first),
                  ),
                ),
                Flexible(
                  child: tags.isEmpty
                      ? const Padding(
                          padding: EdgeInsets.all(20),
                          child: Text('No tags yet. Add tags to contacts to send to groups.', style: TextStyle(color: Brand.muted)),
                        )
                      : ListView(
                          shrinkWrap: true,
                          children: [
                            for (final (tag, n) in tags)
                              CheckboxListTile(
                                value: chosen.contains(tag),
                                onChanged: (v) => set(() => v == true ? chosen.add(tag) : chosen.remove(tag)),
                                title: Text(tag),
                                secondary: Text('$n', style: const TextStyle(color: Brand.muted)),
                                controlAffinity: ListTileControlAffinity.leading,
                              ),
                          ],
                        ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                  child: FilledButton(onPressed: () => Navigator.pop(sheet, true), child: const Text('Show them')),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (ok == true) setState(() => _filter = _filter.copyWith(tags: chosen, tagMode: mode));
  }

  Future<void> _campaignsSheet(List<Map<String, dynamic>> campaigns) async {
    var chosen = {..._filter.campaignIds};
    var received = _filter.received;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheet) => StatefulBuilder(
        builder: (sheet, set) => SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(sheet).size.height * 0.8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 20),
                  child: Text('Past campaigns', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 10, 20, 6),
                  child: SegmentedButton<bool>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: true, label: Text('Got it')),
                      ButtonSegment(value: false, label: Text('Did not get it')),
                    ],
                    selected: {received},
                    onSelectionChanged: (s) => set(() => received = s.first),
                  ),
                ),
                Flexible(
                  child: campaigns.isEmpty
                      ? const Padding(
                          padding: EdgeInsets.all(20),
                          child: Text('No campaigns sent yet.', style: TextStyle(color: Brand.muted)),
                        )
                      : ListView(
                          shrinkWrap: true,
                          children: [
                            for (final c in campaigns)
                              CheckboxListTile(
                                value: chosen.contains('${c['id']}'),
                                onChanged: (v) => set(() => v == true ? chosen.add('${c['id']}') : chosen.remove('${c['id']}')),
                                title: Text('${c['name']}'),
                                subtitle: Text('${formatWhen(c['created_at'])} · ${c['total_contacts'] ?? 0} people'),
                                controlAffinity: ListTileControlAffinity.leading,
                              ),
                          ],
                        ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                  child: FilledButton(onPressed: () => Navigator.pop(sheet, true), child: const Text('Show them')),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (ok == true) {
      setState(() => _filter = _filter.copyWith(campaignIds: chosen, received: received));
      await _needParticipants(chosen);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final all = campaignContacts(app).where((c) => c['_waiting'] != true).toList();
    final campaigns = [for (final c in ((app.cached('campaigns:all') ?? app.cached('campaigns'))?['campaigns'] as List? ?? const [])) Map<String, dynamic>.from(c)]
        .where((c) => c['status'] != 'SCHEDULED')
        .toList();
    final participants = participantSet(_participants, _filter.campaignIds);
    final shown = all.where((c) => _filter.matches(c, participants)).toList();
    final ticked = _ticked(all);
    final shownIds = {for (final c in shown) '${c['id']}'};
    final shownTicked = shownIds.where(ticked.contains).length;
    final list = buildRecipients(all.where((c) => ticked.contains('${c['id']}')).map((c) => (c['phone_number'] as Object?, const <String, String>{})));
    final hidden = ticked.length - shownTicked;

    return Scaffold(
      appBar: AppBar(title: const Text('Choose people')),
      body: Column(
        children: [
          SearchField(
            hint: 'Search name or number',
            onChanged: (v) => setState(() => _filter = _filter.copyWith(search: v)),
          ),
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              children: [
                ActionChip(
                  avatar: const Icon(Icons.sell_outlined, size: 18),
                  label: Text(_filter.tags.isEmpty ? 'Tags' : '${_filter.tagMode == TagMode.none ? 'Not' : (_filter.tagMode == TagMode.all ? 'All' : 'Any')}: ${_filter.tags.join(', ')}'),
                  onPressed: () => _tagsSheet(countTags(all)),
                ),
                const SizedBox(width: 8),
                ActionChip(
                  avatar: _loadingParticipants ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.history, size: 18),
                  label: Text(
                    _filter.campaignIds.isEmpty ? 'Past campaigns' : '${_filter.received ? 'Got' : 'Did not get'} ${_filter.campaignIds.length} campaign${_filter.campaignIds.length == 1 ? '' : 's'}',
                  ),
                  onPressed: () => _campaignsSheet(campaigns),
                ),
                if (_filter.active) ...[
                  const SizedBox(width: 8),
                  ActionChip(
                    label: const Text('Clear filters'),
                    onPressed: () => setState(() => _filter = AudienceFilter(search: _filter.search)),
                  ),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${shown.length} shown · $shownTicked ticked',
                    style: const TextStyle(fontSize: 13, color: Brand.muted, fontWeight: FontWeight.w600),
                  ),
                ),
                TextButton(
                  onPressed: shown.isEmpty
                      ? null
                      : () => setState(() {
                          final next = {...ticked};
                          if (shownTicked == shown.length) {
                            next.removeAll(shownIds);
                          } else {
                            next.addAll(shownIds);
                          }
                          _picked = next;
                        }),
                  child: Text(shownTicked == shown.length && shown.isNotEmpty ? 'Untick shown' : 'Tick shown'),
                ),
              ],
            ),
          ),
          Expanded(
            child: all.isEmpty
                ? const EmptyState(icon: Icons.people_outline, title: 'No contacts yet', text: 'Add contacts first, or upload a list instead.')
                : shown.isEmpty
                ? const EmptyState(icon: Icons.filter_alt_off_outlined, title: 'Nobody matches', text: 'Change the search or the filters.')
                : ListView.builder(
                    itemCount: shown.length,
                    itemBuilder: (context, i) {
                      final c = shown[i];
                      final id = '${c['id']}';
                      final ok = phoneDigits(c['phone_number']).isNotEmpty;
                      final tags = tagsOf(c);
                      return CheckboxListTile(
                        value: ticked.contains(id),
                        onChanged: (v) => setState(() {
                          final next = {...ticked};
                          v == true ? next.add(id) : next.remove(id);
                          _picked = next;
                        }),
                        controlAffinity: ListTileControlAffinity.leading,
                        title: Text(contactName(c), style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text(
                          ok ? [c['phone_number'], if (tags.isNotEmpty) tags.join(', ')].join(' · ') : 'No WhatsApp number · will be left out',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: ok ? Brand.muted : Brand.red, fontSize: 13),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Brand.line)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${list.recipients.length} will get it', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                    Text(
                      [if (hidden > 0) '$hidden ticked but not shown', if (list.invalid > 0) '${list.invalid} without a number', if (list.duplicates > 0) '${list.duplicates} repeated'].join(' · '),
                      style: const TextStyle(fontSize: 12, color: Brand.muted),
                    ),
                  ],
                ),
              ),
              FilledButton(onPressed: () => Navigator.pop(context, (ticked, _filter)), child: const Text('Done')),
            ],
          ),
        ),
      ),
    );
  }
}
