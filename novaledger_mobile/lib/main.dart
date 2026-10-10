import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'ui/screens/home_screen.dart';
import 'ui/theme/app_theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const NovaLedgerMobileApp());
}

class NovaLedgerMobileApp extends StatelessWidget {
  const NovaLedgerMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '星芒账本 · NovaLedger',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.system,
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('zh', 'CN'),
        Locale('en', 'US'),
      ],
      home: const HomeScreen(),
    );
  }
}
