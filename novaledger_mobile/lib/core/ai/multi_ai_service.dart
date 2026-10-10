import 'dart:convert';
import 'dart:io';
import '../database/database_helper.dart';

enum AIProvider { deepseek, gemini, openai }

class MultiAIService {
  static const String _keyProvider = 'ai_provider';
  static const String _keyDeepSeekKey = 'ai_key_deepseek';
  static const String _keyGeminiKey = 'ai_key_gemini';
  static const String _keyOpenAIKey = 'ai_key_openai';
  static const String _keyBaseUrl = 'ai_base_url';
  static const String _keyModel = 'ai_model';

  /// 获取当前选择的 AI 提供商 (默认 deepseek)
  static Future<AIProvider> getCurrentProvider() async {
    final val = await DatabaseHelper.instance.getSetting(_keyProvider);
    if (val == 'gemini') return AIProvider.gemini;
    if (val == 'openai') return AIProvider.openai;
    return AIProvider.deepseek;
  }

  static Future<void> setProvider(AIProvider provider) async {
    await DatabaseHelper.instance.setSetting(_keyProvider, provider.name);
  }

  static Future<String?> getApiKey(AIProvider provider) async {
    switch (provider) {
      case AIProvider.deepseek:
        return await DatabaseHelper.instance.getSetting(_keyDeepSeekKey);
      case AIProvider.gemini:
        return await DatabaseHelper.instance.getSetting(_keyGeminiKey);
      case AIProvider.openai:
        return await DatabaseHelper.instance.getSetting(_keyOpenAIKey);
    }
  }

  static Future<void> setApiKey(AIProvider provider, String key) async {
    final trimmed = key.trim();
    switch (provider) {
      case AIProvider.deepseek:
        await DatabaseHelper.instance.setSetting(_keyDeepSeekKey, trimmed);
        break;
      case AIProvider.gemini:
        await DatabaseHelper.instance.setSetting(_keyGeminiKey, trimmed);
        break;
      case AIProvider.openai:
        await DatabaseHelper.instance.setSetting(_keyOpenAIKey, trimmed);
        break;
    }
  }

  static Future<String> getBaseUrl(AIProvider provider) async {
    final custom = await DatabaseHelper.instance.getSetting('${_keyBaseUrl}_${provider.name}');
    if (custom != null && custom.isNotEmpty) return custom;
    switch (provider) {
      case AIProvider.deepseek:
        return 'https://api.deepseek.com';
      case AIProvider.gemini:
        return 'https://generativelanguage.googleapis.com';
      case AIProvider.openai:
        return 'https://api.openai.com/v1';
    }
  }

  static Future<void> setBaseUrl(AIProvider provider, String url) async {
    await DatabaseHelper.instance.setSetting('${_keyBaseUrl}_${provider.name}', url.trim());
  }

  static Future<String> getModelName(AIProvider provider) async {
    final custom = await DatabaseHelper.instance.getSetting('${_keyModel}_${provider.name}');
    if (custom != null && custom.isNotEmpty) return custom;
    switch (provider) {
      case AIProvider.deepseek:
        return 'deepseek-chat';
      case AIProvider.gemini:
        return 'gemini-1.5-flash';
      case AIProvider.openai:
        return 'gpt-4o-mini';
    }
  }

  static Future<void> setModelName(AIProvider provider, String model) async {
    await DatabaseHelper.instance.setSetting('${_keyModel}_${provider.name}', model.trim());
  }

  /// AI 智能推荐分类 (支持 DeepSeek / Gemini / OpenAI 兼容接口)
  static Future<String?> suggestCategory({
    required String payee,
    required String narration,
    required double amount,
    required List<String> availableCategories,
  }) async {
    // 0. 优先命中本地从电脑端同步过来的商户规则 (0 延迟，0 流量)
    final rulesJson = await DatabaseHelper.instance.getSetting('merchant_rules');
    if (rulesJson != null && rulesJson.isNotEmpty) {
      try {
        final List<dynamic> rules = json.decode(rulesJson);
        for (final r in rules) {
          final kw = (r['keyword'] ?? '').toString().trim();
          if (kw.isNotEmpty && (payee.contains(kw) || narration.contains(kw))) {
            final target = (r['target_category'] ?? '').toString();
            if (target.isNotEmpty && (availableCategories.isEmpty || availableCategories.contains(target))) {
              return target;
            }
          }
        }
      } catch (_) {}
    }

    final provider = await getCurrentProvider();
    final apiKey = await getApiKey(provider);
    if (apiKey == null || apiKey.isEmpty) return null;

    final prompt = '''
你是一个个人复式记账智能助手。
请根据以下消费记录，从备选 Beancount 科目列表中选择最合适的一个科目。
消费商户: "$payee"
消费说明: "$narration"
金额: $amount 元

备选科目列表:
${availableCategories.join('\n')}

请仅输出选中的分类科目名称（如 Expenses:Food:Dining），不要附带任何解释或其他标点。若无法判断，请输出 Expenses:Other。
''';

    try {
      if (provider == AIProvider.deepseek || provider == AIProvider.openai) {
        return await _invokeOpenAICompatible(provider, apiKey, prompt, availableCategories);
      } else {
        return await _invokeGemini(apiKey, prompt, availableCategories);
      }
    } catch (_) {
      return null;
    }
  }

  static Future<String?> _invokeOpenAICompatible(
    AIProvider provider,
    String apiKey,
    String prompt,
    List<String> availableCategories,
  ) async {
    final baseUrl = await getBaseUrl(provider);
    final model = await getModelName(provider);
    final url = Uri.parse('$baseUrl/chat/completions');

    final client = HttpClient()..connectionTimeout = const Duration(seconds: 10);
    final request = await client.postUrl(url);
    request.headers.set('Authorization', 'Bearer $apiKey');
    request.headers.set('Content-Type', 'application/json');

    final body = json.encode({
      'model': model,
      'messages': [
        {'role': 'system', 'content': '你是一个精准的会计分类推断器，只输出科目代码。'},
        {'role': 'user', 'content': prompt},
      ],
      'temperature': 0.1,
    });
    request.write(body);

    final response = await request.close().timeout(const Duration(seconds: 12));
    if (response.statusCode == 200) {
      final responseBody = await response.transform(utf8.decoder).join();
      final data = json.decode(responseBody);
      final content = data['choices']?[0]?['message']?['content']?.toString().trim();
      return _matchCategory(content, availableCategories);
    }
    return null;
  }

  static Future<String?> _invokeGemini(
    String apiKey,
    String prompt,
    List<String> availableCategories,
  ) async {
    final model = await getModelName(AIProvider.gemini);
    final url = Uri.parse('https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent?key=$apiKey');

    final client = HttpClient()..connectionTimeout = const Duration(seconds: 10);
    final request = await client.postUrl(url);
    request.headers.set('Content-Type', 'application/json');

    final body = json.encode({
      'contents': [
        {
          'parts': [{'text': prompt}]
        }
      ]
    });
    request.write(body);

    final response = await request.close().timeout(const Duration(seconds: 12));
    if (response.statusCode == 200) {
      final responseBody = await response.transform(utf8.decoder).join();
      final data = json.decode(responseBody);
      final text = data['candidates']?[0]?['content']?['parts']?[0]?['text']?.toString().trim();
      return _matchCategory(text, availableCategories);
    }
    return null;
  }

  static String? _matchCategory(String? raw, List<String> available) {
    if (raw == null || raw.isEmpty) return null;
    for (final cat in available) {
      if (raw.contains(cat) || cat.contains(raw)) return cat;
    }
    return raw;
  }
}
