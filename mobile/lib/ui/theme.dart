import 'package:flutter/material.dart';

/// WAMA CRM colours: navy, one blue, greys, and red only for things that need attention.
class Brand {
  static const navy = Color(0xFF0E1B3D);
  static const blue = Color(0xFF1D5BEA);
  static const blueHover = Color(0xFF174BC4);
  static const blueSoft = Color(0xFFEEF3FE);
  static const page = Color(0xFFF4F6FA);
  static const line = Color(0xFFE3E8F2);
  static const lineSoft = Color(0xFFEEF1F6);
  static const border = Color(0xFFD5DDEB);
  static const text = Color(0xFF0E1B3D);
  static const textSoft = Color(0xFF4A5672);
  static const muted = Color(0xFF6B7894);
  static const faint = Color(0xFF8A94A8);
  static const red = Color(0xFFB91C1C);
  static const redSoft = Color(0xFFFDF0F0);
}

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(seedColor: Brand.blue, primary: Brand.blue, secondary: Brand.navy, error: Brand.red, surface: Colors.white),
    scaffoldBackgroundColor: Brand.page,
  );
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
  OutlineInputBorder box(Color color, [double width = 1]) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: BorderSide(color: color, width: width),
  );
  return base.copyWith(
    textTheme: base.textTheme.apply(bodyColor: Brand.text, displayColor: Brand.text),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: Brand.navy,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: TextStyle(color: Brand.navy, fontSize: 19, fontWeight: FontWeight.w800, letterSpacing: -0.2),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Brand.line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Brand.blue,
        foregroundColor: Colors.white,
        minimumSize: const Size(48, 48),
        shape: rounded,
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Brand.navy,
        minimumSize: const Size(48, 48),
        side: const BorderSide(color: Brand.border),
        shape: rounded,
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: Brand.blue,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: const TextStyle(color: Brand.faint),
      labelStyle: const TextStyle(color: Brand.textSoft),
      border: box(Brand.border),
      enabledBorder: box(Brand.border),
      focusedBorder: box(Brand.blue, 2),
      errorBorder: box(Brand.red),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: Colors.white,
      selectedColor: Brand.navy,
      side: const BorderSide(color: Brand.border),
      labelStyle: WidgetStateTextStyle.resolveWith((states) => TextStyle(color: states.contains(WidgetState.selected) ? Colors.white : Brand.textSoft, fontWeight: FontWeight.w600)),
      secondaryLabelStyle: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      showCheckmark: false,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: Brand.blueSoft,
      height: 68,
      labelTextStyle: WidgetStateProperty.resolveWith((states) => TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: states.contains(WidgetState.selected) ? Brand.navy : Brand.muted)),
      iconTheme: WidgetStateProperty.resolveWith((states) => IconThemeData(color: states.contains(WidgetState.selected) ? Brand.blue : Brand.muted)),
    ),
    dividerTheme: const DividerThemeData(color: Brand.lineSoft, space: 1, thickness: 1),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: Brand.navy),
  );
}
