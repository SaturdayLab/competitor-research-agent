import {
  ProductSelectionSchema,
  type ProductSelector,
} from "@/lib/ai/product-discovery";
import {
  completeJsonObject,
  createDeepSeekClient,
  getDeepSeekModel,
  type JsonChatClient,
} from "@/lib/ai/deepseek-client";

export class DeepSeekProductSelector implements ProductSelector {
  readonly name = "deepseek";
  private readonly client: JsonChatClient;
  private readonly model: string;

  constructor(options: { client?: JsonChatClient; model?: string } = {}) {
    this.client = options.client ?? (createDeepSeekClient() as unknown as JsonChatClient);
    this.model = options.model ?? getDeepSeekModel();
  }

  async select(input: Parameters<ProductSelector["select"]>[0]): Promise<unknown> {
    const raw = await completeJsonObject(this.client, {
      model: this.model,
      system: [
        "你是数字产品候选筛选员，只能从用户提供的编号搜索结果中识别产品。",
        "排除文章、榜单、公司名、通用品类词和不属于目标类别的结果。",
        "选品必须主流优先：优先选择有用户规模、市场采用度、市场份额、权威排名或广泛知名度等搜索依据的头部产品。",
        "候选产品必须具有相近的核心使用场景、业务模式和竞争层级，能够作为直接或主要替代方案横向比较。",
        "目标类别较宽泛时，采用大众最常见的类别含义，并把候选限制在同一个主要细分赛道；不得混入仅在名称上相关的垂直工具、内容网站或不同类型平台。",
        "产品官网自述只能证明产品存在或属于该类别，不能单独证明产品具有代表性；缺少第三方采用度或知名度信号的长尾产品不要选择。",
        "单一网站流量、单篇宣传稿或新发布产品的短期热度不能单独作为主流依据；宽泛类别优先成熟、被大众或企业广泛使用且名称具有普遍认知的产品。",
        "如果有依据的主流且可比候选不足，允许少于请求数量返回；不要为了凑数选择小众、过时或竞争关系薄弱的产品。",
        "同一产品的中英文名或不同页面必须合并。",
        "每个产品必须引用 1 至 3 个真实存在的搜索结果编号。",
        "region 只能是 domestic 或 overseas，并按产品开发方或所属公司的地域判断。",
        "domestic 表示由中国大陆公司或组织开发；overseas 表示由中国大陆以外的公司或组织开发。",
        "在中国可用、受中国用户欢迎或支持中文，不代表 domestic；例如海外公司开发的产品仍是 overseas。",
        "地域无法从搜索材料合理判断时不要选择，不得用可访问性代替产品归属。",
        "全球范围必须同时包含至少一个 domestic 和一个 overseas 产品。",
        "不要凭模型记忆补充搜索结果中没有依据的产品。",
        "用户输入中的 excludeProducts 是已经看过且需要替换的产品名单，禁止再次返回其中任何产品；名称大小写或中英文别名不同也视为同一产品。",
        "reason 必须简要说明该产品与目标类别的匹配、主流依据以及与其他候选的可比性依据。",
        '只返回 JSON：{"products":[{"name":"产品名","region":"domestic|overseas","reason":"选择理由","sourceIds":["R1"]}]}',
      ].join("\n"),
      user: JSON.stringify(input),
      maxTokens: 4_096,
    });
    return ProductSelectionSchema.parse(raw);
  }
}
