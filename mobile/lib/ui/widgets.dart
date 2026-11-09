import 'package:flutter/material.dart';

import '../data/app_state.dart';
import '../data/format.dart';
import 'theme.dart';

/// The strip under the title bar: offline, sending, or changes that need a look.
class SyncBanner extends StatelessWidget {
  const SyncBanner({super.key, this.cacheKey});

  /// The list this screen shows, to say how old the copy on the phone is.
  final String? cacheKey;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final waiting = app.waitingCount;
    final failed = app.failedCount;
    if (app.online && waiting == 0) return const SizedBox.shrink();
    final saved = cacheKey == null ? null : app.savedAt(cacheKey!);
    late final IconData icon;
    late final String text;
    var attention = false;
    if (failed > 0) {
      icon = Icons.error_outline;
      text = '$failed change${failed == 1 ? '' : 's'} could not be saved. Tap to see why.';
      attention = true;
    } else if (!app.online) {
      icon = Icons.cloud_off_outlined;
      text = 'Offline. ${waiting > 0 ? '$waiting change${waiting == 1 ? '' : 's'} will sync when you are back online.' : 'Showing what was saved ${formatAgo(saved)}.'}';
    } else {
      icon = Icons.sync;
      text = 'Syncing $waiting change${waiting == 1 ? '' : 's'}…';
    }
    return Material(
      color: attention ? Brand.redSoft : Brand.navy,
      child: InkWell(
        onTap: () => Navigator.of(context).pushNamed('/sync'),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              Icon(icon, size: 18, color: attention ? Brand.red : Colors.white),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  text,
                  style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: attention ? Brand.red : Colors.white),
                ),
              ),
              Icon(Icons.chevron_right, size: 18, color: attention ? Brand.red : Colors.white70),
            ],
          ),
        ),
      ),
    );
  }
}

class Avatar extends StatelessWidget {
  const Avatar(this.name, {super.key, this.size = 42});
  final String name;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(size * 0.32)),
      child: Text(
        initials(name),
        style: TextStyle(color: Brand.blue, fontWeight: FontWeight.w800, fontSize: size * 0.36),
      ),
    );
  }
}

/// A small coloured label: navy for normal, blue for good, red for attention, grey for done.
class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = PillTone.grey, this.icon});
  final String text;
  final PillTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      PillTone.blue => (Brand.blueSoft, Brand.blue),
      PillTone.navy => (Brand.navy, Colors.white),
      PillTone.red => (Brand.redSoft, Brand.red),
      PillTone.grey => (Brand.page, Brand.textSoft),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 12, color: fg), const SizedBox(width: 4)],
          Flexible(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: fg),
            ),
          ),
        ],
      ),
    );
  }
}

enum PillTone { grey, blue, navy, red }

/// "Waiting to sync" on something made on the phone.
class WaitingPill extends StatelessWidget {
  const WaitingPill({super.key, this.failed = false});
  final bool failed;
  @override
  Widget build(BuildContext context) => failed ? const Pill('Not saved', tone: PillTone.red, icon: Icons.error_outline) : const Pill('Waiting to sync', tone: PillTone.navy, icon: Icons.schedule);
}

class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
    child: Row(
      children: [
        Expanded(
          child: Text(
            text.toUpperCase(),
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 0.6, color: Brand.faint),
          ),
        ),
        ?trailing,
      ],
    ),
  );
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, required this.text, this.action});
  final IconData icon;
  final String title;
  final String text;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
    child: Column(
      children: [
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Brand.line),
          ),
          child: Icon(icon, color: Brand.textSoft),
        ),
        const SizedBox(height: 14),
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 14, color: Brand.muted, height: 1.4),
        ),
        if (action != null) ...[const SizedBox(height: 16), action!],
      ],
    ),
  );
}

/// A white rounded box with a thin border.
class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.onTap});
  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Card(
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: Padding(padding: padding, child: child),
    ),
  );
}

// ── Phone number with a country code ──

class Country {
  const Country(this.name, this.flag, this.code, this.hint);
  final String name, flag, code, hint;
}

const countries = [
  Country('India', '🇮🇳', '+91', '98765 43210'),
  Country('United Arab Emirates', '🇦🇪', '+971', '50 123 4567'),
  Country('United States', '🇺🇸', '+1', '415 555 0123'),
  Country('United Kingdom', '🇬🇧', '+44', '7911 123456'),
  Country('Saudi Arabia', '🇸🇦', '+966', '50 123 4567'),
  Country('Qatar', '🇶🇦', '+974', '3312 3456'),
  Country('Kuwait', '🇰🇼', '+965', '5123 4567'),
  Country('Oman', '🇴🇲', '+968', '9123 4567'),
  Country('Bahrain', '🇧🇭', '+973', '3600 1234'),
  Country('Singapore', '🇸🇬', '+65', '8123 4567'),
  Country('Malaysia', '🇲🇾', '+60', '12-345 6789'),
  Country('Australia', '🇦🇺', '+61', '412 345 678'),
  Country('Canada', '🇨🇦', '+1', '416 555 0123'),
  Country('Germany', '🇩🇪', '+49', '151 1234567'),
  Country('Sri Lanka', '🇱🇰', '+94', '71 234 5678'),
  Country('Nepal', '🇳🇵', '+977', '984-1234567'),
  Country('Bangladesh', '🇧🇩', '+880', '1712-345678'),
];

/// Split +971501234567 into its country and the rest (India when there is no code).
(Country, String) splitPhone(String? value) {
  final raw = (value ?? '').replaceFirst('whatsapp:', '').trim();
  if (raw.startsWith('+')) {
    final digits = '+${raw.replaceAll(RegExp(r'\D'), '')}';
    final byLength = [...countries]..sort((a, b) => b.code.length - a.code.length);
    for (final c in byLength) {
      if (digits.startsWith(c.code)) return (c, digits.substring(c.code.length));
    }
  }
  return (countries.first, raw.replaceAll(RegExp(r'[^\d ]'), ''));
}

/// `+<code><digits>`, or '' when nothing is typed.
String joinPhone(Country country, String local) {
  final digits = local.replaceAll(RegExp(r'\D'), '').replaceFirst(RegExp(r'^0+'), '');
  return digits.isEmpty ? '' : '${country.code}$digits';
}

class PhoneField extends StatefulWidget {
  const PhoneField({super.key, required this.value, required this.onChanged, this.label = 'Mobile number', this.errorText});
  final String value;
  final ValueChanged<String> onChanged;
  final String label;

  /// What is wrong with the number (shown under it), or null.
  final String? errorText;
  @override
  State<PhoneField> createState() => _PhoneFieldState();
}

class _PhoneFieldState extends State<PhoneField> {
  late Country _country;
  late final TextEditingController _number;

  @override
  void initState() {
    super.initState();
    final (country, local) = splitPhone(widget.value);
    _country = country;
    _number = TextEditingController(text: local);
  }

  @override
  void dispose() {
    _number.dispose();
    super.dispose();
  }

  void _emit() => widget.onChanged(joinPhone(_country, _number.text));

  Future<void> _pick() async {
    final picked = await showModalBottomSheet<Country>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text('Country code', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            ),
            for (final c in countries)
              ListTile(
                leading: Text(c.flag, style: const TextStyle(fontSize: 22)),
                title: Text(c.name),
                trailing: Text(
                  c.code,
                  style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.textSoft),
                ),
                selected: c == _country,
                onTap: () => Navigator.pop(context, c),
              ),
          ],
        ),
      ),
    );
    if (picked != null) {
      setState(() => _country = picked);
      _emit();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: _pick,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            height: 54,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Brand.border),
            ),
            child: Row(
              children: [
                Text(_country.flag, style: const TextStyle(fontSize: 20)),
                const SizedBox(width: 6),
                Text(_country.code, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                const Icon(Icons.expand_more, size: 18, color: Brand.faint),
              ],
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: TextField(
            controller: _number,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(labelText: widget.label, hintText: _country.hint, errorText: widget.errorText, errorMaxLines: 2),
            onChanged: (text) {
              if (text.trim().startsWith('+')) {
                final (country, local) = splitPhone(text);
                _country = country;
                _number.value = TextEditingValue(
                  text: local,
                  selection: TextSelection.collapsed(offset: local.length),
                );
                setState(() {});
              }
              _emit();
            },
          ),
        ),
      ],
    );
  }
}

void toast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}
