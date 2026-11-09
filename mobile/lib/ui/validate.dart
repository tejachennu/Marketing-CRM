/// Checks for what people type, with the problem in plain words (null when it is fine).
library;

final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');

/// A full number (`+<code><digits>`) from the phone field.
String? phoneError(String full, {bool required = false}) {
  final digits = full.replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) return required ? 'Enter the mobile number.' : null;
  if (full.startsWith('+91')) {
    final local = digits.substring(2);
    if (local.length != 10) return 'An Indian mobile number has 10 digits (you typed ${local.length}).';
    if (!RegExp(r'^[6-9]').hasMatch(local)) return 'An Indian mobile number starts with 6, 7, 8 or 9.';
    return null;
  }
  if (digits.length < 8 || digits.length > 15) return 'That number looks too ${digits.length < 8 ? 'short' : 'long'}. Check it and the country code.';
  return null;
}

String? emailError(String value, {bool required = false}) {
  final v = value.trim();
  if (v.isEmpty) return required ? 'Enter your email.' : null;
  return _email.hasMatch(v) ? null : 'That email does not look right, like name@gmail.com.';
}

String? textError(String value, {required String what, int min = 1, int max = 1000}) {
  final v = value.trim();
  if (v.isEmpty) return 'Enter $what.';
  if (v.length < min) return '${what[0].toUpperCase()}${what.substring(1)} is too short (at least $min letters).';
  if (v.length > max) return '${what[0].toUpperCase()}${what.substring(1)} is too long (at most $max letters).';
  return null;
}

String? passwordError(String value) => value.isEmpty
    ? 'Enter a password.'
    : value.length < 6
    ? 'Use at least 6 letters or numbers.'
    : null;
