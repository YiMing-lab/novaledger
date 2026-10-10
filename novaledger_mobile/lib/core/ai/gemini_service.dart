import 'package:google_generative_ai/google_generative_ai.dart';
import '../database/database_helper.dart';

class GeminiService {
  static const String _keySetting = 'gemini_api_key';
  static const String _modelSetting = 'gemini_model';

  /// 获取存储的 API Key
  static Future<String?> getApiKey() async {
    return await DatabaseHelper.instance.getSetting(_keySetting);
  }

  /// 保存 API Key
  static Future<void> saveApiKey(String key) async {
    await DatabaseHelper.instance.setSetting(_keySetting, key.trim());
  }

  /// AI 智能推荐分类
  static Future<String?> suggestCategory({
    required String payee,
    required String narration,
    required double amount,
    required List<String> availableCategories,
  }) async {
    final apiKey = await getApiKey();
    if (apiKey == null || apiKey.isEmpty) return null;

    final modelName = await DatabaseHelper.instance.getSetting(_modelSetting) ?? 'gemini-1.5-flash';

    try {
      final model = GenerativeModel(model: modelName, apiKey: apiKey);
      final prompt = '''
你是一个个人财务记账 AI 助手。
请根据以下消费信息，从备选分类列表中选择最合适的一个 Beancount 分类科目。
消费商户: "$payee"
消费说明: "$narration"
金额: $amount 元

备选分类列表:
${availableCategories.join('\n')}

请直接只输出选中的分类科目名称（如 Expenses:Food:Dining），不要附带任何解释或其他字符。如果无法判断，输出 Expenses:Other。
''';

      final response = await model.generateContent([Content.text(prompt)]);
      final text = response.text?.trim();
      if (text != null && text.isNotEmpty) {
        for (final cat in availableCategories) {
          if (text.contains(cat) || cat.contains(text)) {
            return cat;
          }
        }
      }
      return text;
    } catch (_) {
      return null;
    }
  }
}
