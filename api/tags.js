import { dietTags } from './diet.js'

// Every dish has exactly one type, diet tags worked out from what it contains (diet.js), and optional extras.
export const TYPES = ['main', 'snack', 'side', 'soup', 'noodles', 'bread', 'dessert', 'deli', 'drink']
export const DIET_TAGS = ['meat', 'seafood', 'vegetarian', 'vegan']
export const EXTRAS = ['spicy', 'street']
export const TAGS = [...TYPES, ...DIET_TAGS, ...EXTRAS]

export const composeTags = (type, extras, contains, minor) =>
  [type, ...dietTags(contains, minor), ...EXTRAS.filter(e => extras.includes(e))]

// Fallback guess for custom dishes added without a type (e.g. from an old backup).
// Seeded dishes get their type from seed/types.json.

const RULES = {
  dessert: {
    re: /cake|\btart\b|tarte|pudding|ice cream|gelato|halva|halwa|baklava|cookie|biscuit|chocolate|praline|cannoli|tiramisu|brownie|strudel|mousse|flan\b|custard|kheer|jalebi|gulab|rasgulla|roshogolla|waffle|crêpe|crepe|pancake|macaron|éclair|eclair|churro|donut|doughnut|mochi|sorbet|granita|shortbread|toffee|fudge|lokum|panna cotta|sweet|dulce|alfajor|crumble|cobbler|torte\b|torta\b|kulfi|trifle|pavlova|lamington|bingsu|halo-halo|nougat|turrón|(apple|pumpkin|key lime|peach|pecan|lemon) pie|pastel de nata|pastry|baba|brigadeiro|quindim|tres leches|beignet|profiterole|sachertorte|knafeh|kunafa|kunafeh|basbousa|ma'amoul|sufganiyot|pączki|syrniki|sernik|medovik|koeksister|melktert|malva|tembleque|haupia|shaved ice|kaya|stroopwafel|speculoos|speculaas|poffertjes|oliebollen|semla|bun\b|bulle|krumkaker|lefse|gaz\b|rugelach|sholeh|faloodeh|sandesh|mishti|payasam|watalappan|rasmalai|gozinaki|churchkhela|pakhlava|shekerbura|loukoumades|galaktoboureko|bougatsa|cassata|sfogliatella|zeppole|gâteau/i,
    emoji: /[🍰🍮🍩🍪🍫🍬🍨🍧🍦🍡🧁🎂]/u,
  },
  drink: {
    re: /coffee|café|\bteas?\b(?!\s*(eggs|leaf))|\bchai\b|lassi|juice|punch|cocktail|\bsour\b|caipirinha|mojito|\bmate\b|\bbeer|\bwine|kvass|ayran|horchata|\bboza\b|rakia|\barak\b|soju|\bsake\b|pisco|ouzo|limoncello|kinnie|sorrel|mauby|bissap|karkadeh|\bkava\b|chicha|aguapanela|smoothie|milk\b|bubble tea|\btej\b|kymyz|kumis|airag|shubat|coquito|terremoto|fernet|mamajuana|caesar cocktail|sling|irn-bru|guaraná|l&p|tereré|ginjinha|zivania|horilka|brennivín|melange|flat white|karak|kahwa|gahwa|rum\b|cola\b|lemonade|mint tea|ginger beer/i,
    emoji: /[☕🍵🍹🍸🍺🍷🥤🧋🧉🍶🥛]/u,
  },
  soup: {
    re: /soup|stew\b|broth|chowder|borscht|bisque|gazpacho|salmorejo|\bpho\b|phở|ramen|pozole|harira|chorba|ciorb|shorba|shurpa|çorba|goulash|gulyás|bouillabaisse|cawl|sancocho|caldo|laksa|hot pot|solyanka|shchi|ukha|okroshka|avgolemono|minestra|ribollita|\bsopa\b|cazuela|sinigang|bulalo|congee|kulajda|zuppa|cullen skink|scotch broth|mohinga|dovga|kharcho|chakapuli|ash reshteh|mansaf|tagine|tajine|curanto|thukpa|cioppino|waterzooi/i,
    emoji: /🍲/u,
  },
  bread: {
    re: /bread|naan|\broti\b|chapati|paratha|\bpita\b|baguette|brioche|croissant|focaccia|pizza|flatbread|lavash|injera|\bbun\b|bagel|pretzel|brezel|simit|khachapuri|tortilla|arepa|pupusa|manakish|lahmacun|\bpide\b|\bbao\b|toast|loaf|ciabatta|sourdough|bannock|damper|crumpet|scone|khobz|msemen|matzo|challah|\bpão\b|\bpan\b|pan de|rye\b|brötchen|zopf|pogача|pogacha|burek|börek|gözleme|dosa|appam|hopper|puri\b|bhatura|kulcha|thepla|vetkoek|chipa|pandebono|mantou|baozi|sandwich|sub\b|panini|bruschetta|piadina|pane\b|crostini|tlayuda|gordita|sope\b|empanada|samosa/i,
    emoji: /[🥖🍞🫓🥯🥐🥨🍕🥪]/u,
  },
  noodles: {
    re: /noodle|pasta|spaghetti|ramen|udon|soba\b|pad thai|lagman|tagliatelle|lasagn|tortellini|gnocchi|\bmie\b|\bmee\b|laksa|pancit|japchae|jajang|naengmyeon|bún|bun cha|bánh canh|hủ tiếu|vermicelli|fideu|spätzle|spaetzle|kluski|dan dan|chow mein|chow fun|lo mein|tsukemen|beshbarmak|tsuivan|rechta|couscous|pelmeni|ravioli|carbonara|amatriciana|cacio e pepe|bucatini|orecchiette|pho\b|phở|mohinga|khao soi|khao piak|pad see ew|pad kra|kuy teav|nom banh chok|lamian|biangbiang|zhajiang|cao lầu|mì quảng|pizzoccheri|maltagliati|rigatoni|penne|fettuccine|pappardelle/i,
    emoji: /[🍜🍝]/u,
  },
  spicy: {
    re: /spicy|chili|chilli|jerk|vindaloo|sambal|harissa|kimchi|tteokbokki|piri[- ]?piri|peri[- ]?peri|curry|mapo|szechuan|sichuan|buffalo|hot chicken|zhug|rocoto|\baji\b|ají|shito|pikliz|berbere|nashville|kung pao|chongqing|vindaloo|rendang|massaman|panang|tom yum|som tam|larb|laap|pepper crab|sisig|bicol express|ayam penyet|nasi padang|piripiri|merguez|harissa|dan dan|rogan josh|chettinad|laal maas|gongura|kosha|pork vindaloo/i,
    emoji: /🌶️/u,
  },
}

// Noodle soups count as noodles, so noodles is checked before soup.
const GUESS_ORDER = ['dessert', 'drink', 'noodles', 'soup', 'bread']

// [type, ...extras]
export function deriveTags(name, emoji) {
  const hit = tag => RULES[tag].re.test(name) || (emoji && RULES[tag].emoji.test(emoji))
  return [GUESS_ORDER.find(hit) || 'main', ...(hit('spicy') ? ['spicy'] : [])]
}
