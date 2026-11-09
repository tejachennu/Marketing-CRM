import 'dart:convert';
import 'dart:typed_data';

import 'package:excel/excel.dart';

/// Who a campaign goes to: the same rules as the web (lib/campaigns/audience.ts), so a number is
/// messaged once, and a number the server would drop is not counted.

/// The digits of a phone number in international form, or '' when it cannot be one.
/// A bare 10-digit Indian mobile number (starting 6-9) gets 91 in front.
String phoneDigits(Object? raw) {
  var digits = '${raw ?? ''}'.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('00')) digits = digits.substring(2);
  if (digits.length == 10 && RegExp(r'^[6-9]').hasMatch(digits)) digits = '91$digits';
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}

List<String> tagsOf(Map contact) => {for (final t in (contact['tags'] as List? ?? const [])) '$t'.trim()}.where((t) => t.isNotEmpty).toList();

enum TagMode { any, all, none }

/// What narrows the contact list. Ticks (who actually gets it) are kept apart from these.
class AudienceFilter {
  const AudienceFilter({this.search = '', this.tags = const {}, this.tagMode = TagMode.any, this.campaignIds = const {}, this.received = true});
  final String search;
  final Set<String> tags;
  final TagMode tagMode;
  final Set<String> campaignIds;

  /// true: only people who got those campaigns; false: only people who did not.
  final bool received;

  bool get active => search.trim().isNotEmpty || tags.isNotEmpty || campaignIds.isNotEmpty;

  AudienceFilter copyWith({String? search, Set<String>? tags, TagMode? tagMode, Set<String>? campaignIds, bool? received}) =>
      AudienceFilter(search: search ?? this.search, tags: tags ?? this.tags, tagMode: tagMode ?? this.tagMode, campaignIds: campaignIds ?? this.campaignIds, received: received ?? this.received);

  bool matches(Map contact, Set<String> participants) {
    final q = search.trim().toLowerCase();
    if (q.isNotEmpty) {
      final text = '${contact['first_name'] ?? ''} ${contact['last_name'] ?? ''} ${contact['company'] ?? ''} ${contact['email'] ?? ''}'.toLowerCase();
      final qDigits = q.replaceAll(RegExp(r'\D'), '');
      final phone = '${contact['phone_number'] ?? ''}'.replaceAll(RegExp(r'\D'), '');
      final byPhone = qDigits.isNotEmpty && !RegExp(r'[a-z@]').hasMatch(q) && (phone.contains(qDigits) || phoneDigits(contact['phone_number']).contains(qDigits));
      if (!text.contains(q) && !byPhone) return false;
    }
    if (tags.isNotEmpty) {
      final has = tagsOf(contact).toSet();
      final ok = switch (tagMode) {
        TagMode.any => tags.any(has.contains),
        TagMode.all => tags.every(has.contains),
        TagMode.none => !tags.any(has.contains),
      };
      if (!ok) return false;
    }
    if (campaignIds.isNotEmpty) {
      final got = participants.contains(phoneDigits(contact['phone_number']));
      if (got != received) return false;
    }
    return true;
  }
}

/// Every tag in use, with how many contacts have it, most used first.
List<(String, int)> countTags(List<Map<String, dynamic>> contacts) {
  final counts = <String, int>{};
  for (final c in contacts) {
    for (final t in tagsOf(c)) {
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return counts.entries.map((e) => (e.key, e.value)).toList()..sort((a, b) => b.$2.compareTo(a.$2));
}

/// The numbers the chosen past campaigns went to, as digits.
Set<String> participantSet(Map<String, dynamic> byCampaign, Set<String> ids) => {
  for (final id in ids)
    for (final p in (byCampaign[id] as List? ?? const [])) phoneDigits(p),
}..remove('');

/// One row of the final list.
class Recipient {
  Recipient(this.phone, this.variables);
  final String phone;
  final Map<String, String> variables;
  Map<String, dynamic> toJson() => {'phone': phone, 'variables': variables};
}

class RecipientList {
  RecipientList(this.recipients, this.invalid, this.duplicates);
  final List<Recipient> recipients;

  /// Rows left out: no usable number.
  final int invalid;

  /// Rows left out: the same number came earlier.
  final int duplicates;
}

/// One message per usable, distinct number; the first row for a number wins.
RecipientList buildRecipients(Iterable<(Object?, Map<String, String>)> rows) {
  final out = <Recipient>[];
  final seen = <String>{};
  var invalid = 0, duplicates = 0;
  for (final (address, variables) in rows) {
    final digits = phoneDigits(address);
    if (digits.isEmpty) {
      invalid++;
    } else if (!seen.add(digits)) {
      duplicates++;
    } else {
      out.add(Recipient('+$digits', variables));
    }
  }
  return RecipientList(out, invalid, duplicates);
}

// ── A list from a spreadsheet ──

class SheetData {
  SheetData(this.headers, this.rows);
  final List<String> headers;
  final List<Map<String, String>> rows;

  /// The column that looks most like phone numbers.
  String? get phoneColumn {
    String? best;
    var bestScore = 0;
    for (final h in headers) {
      final named = RegExp(r'phone|mobile|whatsapp|number|contact', caseSensitive: false).hasMatch(h) ? 3 : 0;
      final valid = rows.take(30).where((r) => phoneDigits(r[h]).isNotEmpty).length;
      final score = named + valid;
      if (valid > 0 && score > bestScore) {
        best = h;
        bestScore = score;
      }
    }
    return best;
  }

  /// A column whose name says it is the name.
  String? get nameColumn => headers.cast<String?>().firstWhere((h) => RegExp(r'^(first[ _]?)?name$|customer|full[ _]?name', caseSensitive: false).hasMatch(h!), orElse: () => null);
}

/// Reads a .csv or .xlsx file: the first row is the column names.
SheetData readSheet(String filename, Uint8List bytes) {
  final lower = filename.toLowerCase();
  List<List<String>> table;
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    final book = Excel.decodeBytes(bytes);
    final sheet = book.tables.values.firstWhere((t) => t.maxRows > 0, orElse: () => throw const FormatException('The file has no rows.'));
    table = [
      for (final row in sheet.rows) [for (final cell in row) _cellText(cell?.value)],
    ];
  } else {
    table = parseCsv(utf8.decode(bytes, allowMalformed: true));
  }
  table = table.where((r) => r.any((c) => c.trim().isNotEmpty)).toList();
  if (table.length < 2) throw const FormatException('The file needs a row of column names and at least one person.');
  final headers = <String>[];
  for (var i = 0; i < table.first.length; i++) {
    var h = table.first[i].trim();
    if (h.isEmpty) h = 'Column ${i + 1}';
    while (headers.contains(h)) {
      h = '$h ${i + 1}';
    }
    headers.add(h);
  }
  final rows = [
    for (final r in table.skip(1)) {for (var i = 0; i < headers.length; i++) headers[i]: i < r.length ? r[i].trim() : ''},
  ];
  return SheetData(headers, rows);
}

String _cellText(CellValue? v) => switch (v) {
  null => '',
  // Numbers like 919876543210 must not come out as 9.19e11
  DoubleCellValue(:final value) => value == value.roundToDouble() ? value.toStringAsFixed(0) : '$value',
  IntCellValue(:final value) => '$value',
  TextCellValue(:final value) => value.toString(),
  _ => v.toString(),
};

/// A small CSV reader: commas or semicolons, quotes with "" inside.
List<List<String>> parseCsv(String text) {
  final firstLine = text.split('\n').first;
  final sep = ';'.allMatches(firstLine).length > ','.allMatches(firstLine).length ? ';' : ',';
  final rows = <List<String>>[];
  var row = <String>[];
  final cell = StringBuffer();
  var quoted = false;
  for (var i = 0; i < text.length; i++) {
    final ch = text[i];
    if (quoted) {
      if (ch == '"') {
        if (i + 1 < text.length && text[i + 1] == '"') {
          cell.write('"');
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell.write(ch);
      }
    } else if (ch == '"') {
      quoted = true;
    } else if (ch == sep) {
      row.add(cell.toString());
      cell.clear();
    } else if (ch == '\n' || ch == '\r') {
      if (ch == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++;
      row.add(cell.toString());
      cell.clear();
      rows.add(row);
      row = <String>[];
    } else {
      cell.write(ch);
    }
  }
  if (cell.isNotEmpty || row.isNotEmpty) {
    row.add(cell.toString());
    rows.add(row);
  }
  return rows;
}
