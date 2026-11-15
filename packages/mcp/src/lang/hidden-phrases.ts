// Hidden-instruction phrases in languages other than English (issue #6). scan.ts runs these only
// on the text of hidden comments (<!-- --> and [//]: # titles), after the English patterns.
//
// The bar is zero false positives on real maintainer text, so every entry is a fixed phrase in
// the imperative, not a keyword. What that means in practice, from 1.3 million lines of real docs
// in these languages run through the table as if each line were a hidden comment:
// - In Spanish, Portuguese, French and German the imperative often looks like a statement
//   ("el modelo ignora", "il ignore"), so those verbs must open a clause (LEAD): the start of the
//   comment, after punctuation, or after "please", "and", "now" and similar. Chinese verbs have
//   no form at all and get the same rule (LEAD_ZH). Russian, Japanese, Korean and Hindi have
//   imperative endings, and the patterns ask for them.
// - "Secretly" and "without the user knowing" are common in stories and news ("偷偷收集用户信息"),
//   so a covert phrase counts only next to an imperative action: push, delete, send, run.
// - "Send" needs a secret as its object, in the same sentence, and not next to "header" or
//   "Authorization" (API docs). "Paste your key here" and "print the token" are setup docs.
// - "Hide" needs "the user", "run" needs "any command". No bare "show" or "silently".
//
// Rules for this file, checked by test/hidden-lang.test.ts: every quantifier is bounded ({0,n},
// never * or +), and patterns match lowercased text with no flags (see re below), so they must not
// use \S, \W, \D, \B or \p{...}, which lowercasing would break.

export type HiddenLang = "es" | "fr" | "de" | "pt" | "zh" | "ja" | "ko" | "ru" | "hi";

export const HIDDEN_LANGS: readonly HiddenLang[] = ["es", "fr", "de", "pt", "zh", "ja", "ko", "ru", "hi"];

/** The labels scan.ts already uses for English, so lint.ts keeps the same error/warning split. */
export const LABEL = {
  ignore: "asks to ignore other instructions",
  hide: "asks to hide something from the user",
  covert: "asks for covert action",
  run: "asks to run a command",
  secret: "mentions commands or secrets",
  address: "addresses the AI directly",
} as const;

export type HiddenLabel = (typeof LABEL)[keyof typeof LABEL];

export interface HiddenPhrase {
  lang: HiddenLang;
  label: HiddenLabel;
  regex: RegExp;
}

/** Space between words. {1,9}, not {1,4}: V8 unrolls tiny counted loops, which made compiling slow. */
const S = String.raw`\s{1,9}`;
/**
 * Word edges for the scripts used here (\b is ASCII-only in JavaScript): Latin with accents and
 * combining marks, Cyrillic and Devanagari (not the danda full stops U+0964 and U+0965), on
 * lowercased text. Small ranges instead of \p{L} keep compiling ninety patterns cheap.
 */
const WORD = String.raw`a-z0-9_\u00c0-\u024f\u0300-\u036f\u0400-\u04ff\u0900-\u0963\u0966-\u097f`;
const B = String.raw`(?<![${WORD}])`;
const E = String.raw`(?![${WORD}])`;
const CYR = String.raw`[\u0400-\u04ff]`;
const LAT = String.raw`[a-z\u00c0-\u024f]`;
/** Hangul has no case and no \b; a phrase must not start inside a longer word ("범위" ends in "위", "내보내" holds "보내"). */
const BK = String.raw`(?<![\uac00-\ud7a3])`;
/** End of a sentence: a gap never crosses one. ".env" is not an end, ". " is. */
const STOP = String.raw`[!?;\u3002\uff01\uff1f\u0964]|\.(?:\s|$)`;
/** A bounded gap inside one sentence that does not cross an API-docs word ("send the token in the header"). */
const GAP = (n: number): string =>
  String.raw`(?:(?!${STOP}|header|cabecera|cabe[cç]alho|en-t[eê]te|заголов|ヘッダ|请求头|請求頭|标头|標頭|헤더|हेडर|authorization|bearer)[^\n]){0,${n}}`;
/** A bounded gap inside one sentence. */
const IN = (n: number): string => String.raw`(?:(?!${STOP})[^\n]){0,${n}}`;

// A clause opener for languages where the imperative looks like a statement.
const FILL = [
  `por${S}favor`, "porfa", "y", "e", "et", "und", "bitte", "luego", "ahora", "agora", "maintenant", "puis", "ensuite", "jetzt", "dann",
  "tambi[eé]n", "tamb[eé]m", "aussi", "auch", "simplemente", "simplesmente", "simplement", "einfach", `s['\u2019]il${S}(?:te|vous)${S}pla[iî]t`,
  "depois", "despu[eé]s", "entonces", "ent[aã]o", "apr[eè]s", "danach", "sofort", "inmediatamente", "imediatamente", "imm[eé]diatement",
  "debes", `tienes${S}que`, "deber[aá]s", `tu${S}dois`, `vous${S}devez`, `du${S}musst`, `du${S}sollst`, `voc[eê]${S}deve`, `voc[eê]${S}precisa`,
  `tens${S}de`, `tem${S}que`, `a${S}partir${S}de${S}(?:ahora|agora)`, `[aà]${S}partir${S}de${S}maintenant`, `ab${S}jetzt`, `von${S}nun${S}an`, "please", "now", "then",
].join("|");
const LEAD = String.raw`(?:^|[\n.!?;:,(\[*>"'\u00ab\u201c\u00bf\u00a1-]|\s\u2013\s)\s{0,8}(?:(?:${FILL}),?${S}){0,2}`;
/** The same for Chinese: the verb opens a clause or follows "please", "you must", "then". */
const LEAD_ZH = String.raw`(?:^|[\n\u3002\uff01\uff1f\uff1b\uff0c\u3001\uff1a.!?;,:])\s{0,4}(?:请|請|你|你要|你必须|你必須|你应该|你應該|你需要|务必|務必|一定要|立即|马上|馬上|直接|现在|現在|然后|然後|并|並|再)?\s{0,2}`;
/** Sentence level only (not after a comma), for phrases that also describe: "，在用户不知情的情况下修改" lists a threat. */
const LEAD_ZH_SENT = String.raw`(?:^|[\n\u3002\uff01\uff1f\uff1b\uff1a.!?;:])\s{0,4}(?:请|請|你|你要|你必须|你必須|你应该|你應該|你需要|务必|務必|一定要|立即|马上|馬上|直接|现在|現在|然后|然後|并|並|再)?\s{0,2}`;

// Patterns are written in any case and compiled lowercased with no flags; scan.ts lowercases the
// comment once. Case-insensitive Unicode patterns took about a second to compile.
const re = (...parts: string[]): RegExp => new RegExp(parts.join("").toLowerCase());
const P = (lang: HiddenLang, label: HiddenLabel, ...parts: string[]): HiddenPhrase => ({ lang, label, regex: re(...parts) });
/** A covert phrase next to an imperative action, in either order, inside one sentence. */
const covert = (lead: string, action: string, phrase: string, n = 60): string =>
  String.raw`${lead}(?:${action}${IN(n)}${phrase}|${phrase},?${S}${action})`;

// ---------------------------------------------------------------------------
// Spanish

const ES_USER = String.raw`(?:al|a${S}la|a${S}los|a${S}las|el|la|los)${S}usuari[oa]s?${E}`;
const ES_SECRET = String.raw`${B}(?:(?:claves?${S}(?:de${S}(?:la${S})?)?api|api[_ -]?keys?|tokens?|contrase[nñ]as?|credenciales|secretos|claves?${S}privadas?|claves?${S}ssh|variables?${S}de${S}entorno)${E}|\.env${E})`;
const ES_ACT = String.raw`${B}(?:haz|sube|env[ií]a|manda|borra|elimina|ejecuta|corre|instala|cambia|modifica|a[nñ]ade|agrega|escribe|descarga|fusiona|publica|desactiva|sobrescribe|reemplaza|reescribe|actualiza|crea|copia|mueve|aprueba|despliega|confirma)${E}`;
const ES: HiddenPhrase[] = [
  P("es", LABEL.ignore, LEAD, B, String.raw`(?:ignora|ignore|ignoren|ignorar|olvida|olvide|olviden|olvidar|descarta|descarte|descartar|omite|omita|omitir|desobedece|desobedezca|pasa${S}por${S}alto)${S}(?:(?:todas|todos)${S})?(?:las|los|tus|sus|estas|esas)${S}(?:instrucciones|indicaciones|reglas|[oó]rdenes|directrices|normas|directivas)${S}(?:anteriores|previas|de${S}arriba|del${S}sistema|originales|iniciales|que${S}(?:te${S})?(?:dieron|han${S}dado))`, E),
  P("es", LABEL.ignore, LEAD, B, String.raw`(?:ignora|ignore|olvida|olvide|descarta)${S}(?:todo${S}lo${S}(?:anterior|de${S}arriba|que${S}(?:te${S})?(?:dijeron|han${S}dicho))|lo${S}anterior)`, E),
  P("es", LABEL.ignore, B, String.raw`no${S}(?:sigas|siga|obedezcas|obedezca|hagas${S}caso${S}a|haga${S}caso${S}a|tengas${S}en${S}cuenta|respetes)${S}(?:(?:todas|todos)${S})?(?:las|los|tus|sus|estas)${S}(?:instrucciones|indicaciones|reglas|[oó]rdenes|directrices|normas)${S}(?:anteriores|previas|de${S}arriba|del${S}sistema|originales|iniciales)`, E),
  P("es", LABEL.ignore, LEAD, B, String.raw`(?:ignora|olvida|descarta)${S}(?:todas${S})?tus${S}(?:instrucciones|indicaciones|reglas|directrices)`, E),
  P("es", LABEL.hide, B, String.raw`no${S}(?:se${S}lo${S}|se${S}la${S}|le${S}|les${S})?(?:digas|diga|digan|cuentes|cuente|menciones|mencione|reveles|revele|informes|informe|comuniques|comunique|avises|avise|expliques)`, E, IN(40), B, ES_USER),
  P("es", LABEL.hide, LEAD, B, String.raw`(?:oc[uú]ltale|oc[uú]ltaselo|oculta|oculte|esc[oó]ndele|esconde|esconda)`, E, IN(40), B, String.raw`(?:al|del|a${S}la|de${S}la|a${S}los|de${S}los)${S}usuari[oa]s?`, E),
  P("es", LABEL.covert, covert(LEAD, ES_ACT, String.raw`${B}(?:secretamente|en${S}secreto|a${S}escondidas|sin${S}que${S}(?:el|la|los)${S}usuari[oa]s?${S}(?:lo${S})?(?:sepa|sepan|note|noten|vea|vean|se${S}entere|se${S}d[eé]${S}cuenta)|sin${S}(?:avisar|decir|informar|preguntar|consultar)(?:le|selo)?${S}(?:al|a${S}la|a${S}los)${S}usuari[oa]s?|sin${S}pedir(?:le)?${S}permiso|sin${S}decir${S}nada)${E}`)),
  P("es", LABEL.run, LEAD, B, String.raw`(?:ejecuta|ejecute|ejecutar|corre|lanza)${S}(?:(?:cualquier|todo${S}tipo${S}de)${S}(?:comandos?|scripts?|orden|c[oó]digo)|comandos${S}arbitrarios|c[oó]digo${S}arbitrario)`, E),
  P("es", LABEL.secret, LEAD, B, String.raw`(?:env[ií]a(?:me|nos)?|env[ií]e|manda(?:me)?|mande|sube|suba|filtra|filtre|exfiltra|exfiltre|revela|revele|reenv[ií]a)`, E, GAP(60), ES_SECRET),
  P("es", LABEL.address, B, String.raw`(?:eres|sos)${S}(?:un|una)${S}(?:asistente|agente|modelo${S}de${S}lenguaje|ia|bot|llm|chatbot)`, E),
  P("es", LABEL.address, B, String.raw`(?:nota|instrucciones|mensaje|aviso)${S}(?:para|a)${S}(?:la${S}ia|el${S}(?:agente|asistente|modelo|llm|bot))\s{0,3}:`),
];

// ---------------------------------------------------------------------------
// Portuguese

const PT_USER = String.raw`(?:ao|à|aos|às|a|o|os|para${S}o|para${S}a|com${S}o)${S}usu[aá]ri[oa]s?${E}`;
const PT_SECRET = String.raw`${B}(?:(?:chaves?${S}(?:de${S}|da${S})?api|api[_ -]?keys?|tokens?|senhas?|credenciais|segredos|chaves?${S}privadas?|chaves?${S}ssh|vari[aá]veis${S}de${S}ambiente)${E}|\.env${E})`;
const PT_ACT = String.raw`${B}(?:fa[cç]a|suba|envie|mande|apague|delete|remova|exclua|execute|rode|instale|altere|mude|modifique|adicione|escreva|baixe|publique|desative|sobrescreva|substitua|atualize|crie|copie|mova|aprove|implante|commite)${E}`;
const PT: HiddenPhrase[] = [
  P("pt", LABEL.ignore, LEAD, B, String.raw`(?:ignore|ignora|ignorar|ignorem|esque[cç]a|esquece|esquecer|esque[cç]am|desconsidere|desconsidera|desconsiderar|descarte|descarta|descartar|desobede[cç]a|desobedece)${S}(?:(?:todas|todos)${S})?(?:as|os|suas|tuas|estas|essas)${S}(?:instru[cç][oõ]es|orienta[cç][oõ]es|regras|ordens|diretrizes|diretivas|indica[cç][oõ]es)${S}(?:anteriores|pr[eé]vias|acima|do${S}sistema|originais|iniciais|que${S}(?:voc[eê]${S}recebeu|te${S}deram|lhe${S}deram))`, E),
  P("pt", LABEL.ignore, LEAD, B, String.raw`(?:ignore|ignora|esque[cç]a|esquece|desconsidere|desconsidera)${S}tudo${S}(?:o${S}que${S}(?:foi${S}dito|veio)${S}antes|acima|o${S}que${S}est[aá]${S}acima|(?:o${S})?anterior)`, E),
  P("pt", LABEL.ignore, B, String.raw`n[aã]o${S}(?:siga|sigas|obede[cç]a|obede[cç]as|respeite|respeites|leve${S}em${S}conta)${S}(?:(?:todas|todos)${S})?(?:as|os|suas|tuas|estas)${S}(?:instru[cç][oõ]es|orienta[cç][oõ]es|regras|ordens|diretrizes)${S}(?:anteriores|pr[eé]vias|acima|do${S}sistema|originais|iniciais)`, E),
  P("pt", LABEL.ignore, LEAD, B, String.raw`(?:ignore|ignora|esque[cç]a|esquece|desconsidere)${S}(?:todas${S})?(?:as${S})?(?:suas|tuas)${S}(?:instru[cç][oõ]es|orienta[cç][oõ]es|regras|diretrizes)`, E),
  P("pt", LABEL.hide, B, String.raw`n[aã]o${S}(?:lhe${S}|o${S}|a${S})?(?:conte|contes|diga|digas|mencione|menciones|revele|reveles|informe|informes|avise|avises|fale|fales|comente|comentes)`, E, IN(40), B, PT_USER),
  P("pt", LABEL.hide, LEAD, B, String.raw`(?:esconda|oculte)`, E, IN(40), B, String.raw`(?:do|dos|da|das)${S}usu[aá]ri[oa]s?`, E),
  P("pt", LABEL.covert, covert(LEAD, PT_ACT, String.raw`${B}(?:secretamente|em${S}segredo|[aà]s${S}escondidas|escondid[oa]${S}d[oa]${S}usu[aá]ri[oa]|sem${S}que${S}(?:o|a|os)${S}usu[aá]ri[oa]s?${S}(?:saiba|saibam|perceba|percebam|veja|vejam|note|notem)|sem${S}(?:avisar|contar|informar|perguntar|dizer)(?:${S}nada)?${S}(?:ao|à|aos|o|a|os|para${S}o|para${S}a)${S}usu[aá]ri[oa]s?|sem${S}(?:falar|dizer|avisar)${S}nada)${E}`)),
  P("pt", LABEL.run, LEAD, B, String.raw`(?:execute|executa|executar|rode|roda|rodar)${S}(?:(?:qualquer|quaisquer)${S}(?:comandos?|scripts?|c[oó]digos?)|comandos${S}arbitr[aá]rios|c[oó]digo${S}arbitr[aá]rio)`, E),
  P("pt", LABEL.secret, LEAD, B, String.raw`(?:envie|envia|enviar|mande|manda|suba|vaze|vaza|exfiltre|revele|revela|encaminhe|encaminha)`, E, GAP(60), PT_SECRET),
  P("pt", LABEL.address, B, String.raw`(?:voc[eê]${S}[eé]|tu${S}[eé]s)${S}(?:um|uma)${S}(?:assistente|agente|modelo${S}de${S}linguagem|ia|bot|llm|chatbot)`, E),
  P("pt", LABEL.address, B, String.raw`(?:nota|instru[cç][oõ]es|mensagem|aviso)${S}(?:para|à|ao)${S}(?:a${S}ia|ia|o${S}(?:agente|assistente|modelo|llm|bot))\s{0,3}:`),
];

// ---------------------------------------------------------------------------
// French

const FR_USER = String.raw`(?:[aà]${S}l['\u2019]\s{0,2}|aux${S}|l['\u2019]\s{0,2})utilisat(?:eur|rice)s?${E}`;
const FR_SECRET = String.raw`${B}(?:(?:cl[eé]s?${S}(?:d['\u2019]\s{0,2}|de${S}l['\u2019]\s{0,2})?api|api[_ -]?keys?|jetons?|tokens?|mots?${S}de${S}passe|identifiants|secrets|cl[eé]s?${S}priv[eé]es?|cl[eé]s?${S}ssh|variables?${S}d['\u2019]\s{0,2}environnement)${E}|\.env${E})`;
const FR_ACT = String.raw`${B}(?:fais|faites|pousse|poussez|envoie|envoyez|supprime|supprimez|efface|effacez|ex[eé]cute|ex[eé]cutez|lance|lancez|installe|installez|modifie|modifiez|ajoute|ajoutez|[eé]cris|[eé]crivez|t[eé]l[eé]charge|t[eé]l[eé]chargez|fusionne|fusionnez|publie|publiez|d[eé]sactive|d[eé]sactivez|[eé]crase|[eé]crasez|remplace|remplacez|cr[eé]e|cr[eé]ez|d[eé]place|d[eé]placez|approuve|approuvez|d[eé]ploie|d[eé]ployez|commite|commitez)${E}`;
const FR: HiddenPhrase[] = [
  P("fr", LABEL.ignore, LEAD, B, String.raw`(?:ignore|ignorez|ignorer|oublie|oubliez|oublier|ne${S}tiens${S}pas${S}compte|ne${S}tenez${S}pas${S}compte|fais${S}abstraction|faites${S}abstraction|fais${S}fi|faites${S}fi)${S}(?:de${S})?(?:(?:toutes|tous)${S})?(?:les|tes|vos|ces|des|de${S}(?:toutes${S})?(?:les|tes|vos|ces))${S}(?:instructions|consignes|r[eè]gles|directives|ordres|indications)${S}(?:pr[eé]c[eé]dentes|ant[eé]rieures|ci-dessus|du${S}syst[eè]me|initiales|originales)`, E),
  P("fr", LABEL.ignore, LEAD, B, String.raw`(?:ignore|ignorez|oublie|oubliez)${S}tout${S}ce${S}qui${S}(?:pr[eé]c[eè]de|est${S}au-dessus|a${S}[eé]t[eé]${S}dit${S}avant)`, E),
  P("fr", LABEL.ignore, B, String.raw`ne${S}(?:suis|suivez|respecte|respectez|tiens${S}compte|tenez${S}compte|ob[eé]is|ob[eé]issez)${S}(?:plus|pas|jamais)${S}(?:aux|les|tes|vos|des|[aà]${S}(?:tes|vos))${S}(?:instructions|consignes|r[eè]gles|directives|ordres)${S}(?:pr[eé]c[eé]dentes|ant[eé]rieures|ci-dessus|du${S}syst[eè]me|initiales|originales)`, E),
  P("fr", LABEL.hide, B, String.raw`(?:ne|n['\u2019]\s{0,2}en)${S}(?:le${S}|lui${S}|leur${S}|l['\u2019]\s{0,2})?(?:dis|dites|mentionne|mentionnez|r[eé]v[eè]le|r[eé]v[eé]lez|signale|signalez|raconte|racontez|pr[eé]viens|pr[eé]venez|informe|informez|avertis|avertissez|parle|parlez)${S}(?:rien|pas|jamais|surtout${S}pas)`, E, IN(40), B, FR_USER),
  P("fr", LABEL.hide, LEAD, B, String.raw`ne${S}(?:rien|pas)${S}(?:dire|mentionner|r[eé]v[eé]ler|signaler|raconter)`, E, IN(40), B, FR_USER),
  P("fr", LABEL.hide, LEAD, B, String.raw`(?:cachez|cache-(?:le|la|les|lui)|dissimule|dissimulez)`, E, IN(40), String.raw`(?:[aà]|de)${S}l['\u2019]\s{0,2}utilisat(?:eur|rice)`, E),
  P("fr", LABEL.covert, covert(LEAD, FR_ACT, String.raw`${B}(?:secr[eè]tement|en${S}cachette|en${S}douce|[aà]${S}l['\u2019]\s{0,2}insu${S}de${S}l['\u2019]\s{0,2}utilisat(?:eur|rice)|sans${S}que${S}l['\u2019]\s{0,2}utilisat(?:eur|rice)${S}(?:ne${S})?(?:le${S})?(?:sache|remarque|voie|s['\u2019]\s{0,2}en${S}aper[cç]oive)|sans${S}(?:pr[eé]venir|avertir|informer|le${S}dire${S}[aà]|demander${S}[aà]|en${S}parler${S}[aà])${S}l['\u2019]\s{0,2}utilisat(?:eur|rice)|discr[eè]tement|sans${S}rien${S}dire)${E}`)),
  P("fr", LABEL.run, LEAD, B, String.raw`(?:ex[eé]cute|ex[eé]cutez|ex[eé]cuter|lance|lancez|lancer)${S}(?:n['\u2019]\s{0,2}importe${S}quel(?:le)?s?${S}(?:commandes?|scripts?|code)|des${S}commandes${S}arbitraires|du${S}code${S}arbitraire)`, E),
  P("fr", LABEL.secret, LEAD, B, String.raw`(?:envoie|envoyez|envoie-moi|transmets|transmettez|t[eé]l[eé]verse|t[eé]l[eé]versez|uploade|uploadez|divulgue|divulguez|r[eé]v[eè]le|r[eé]v[eé]lez|exfiltre|exfiltrez|fais${S}fuiter|faites${S}fuiter)`, E, GAP(60), FR_SECRET),
  // Not a bare "agent": "vous êtes un agent public" is a civil servant.
  P("fr", LABEL.address, B, String.raw`(?:tu${S}es|vous${S}[eê]tes)${S}(?:un|une)${S}(?:ia|assistant|assistante|agent${S}(?:ia|d['\u2019]\s{0,2}ia|de${S}code|conversationnel)|mod[eè]le${S}de${S}langage|bot|llm|chatbot)`, E),
  P("fr", LABEL.address, B, String.raw`(?:note|instructions?|message|consignes?)${S}(?:pour|[aà])${S}(?:l['\u2019]\s{0,2}(?:ia|agent|assistant)|le${S}(?:mod[eè]le|bot|llm)|les${S}(?:agents|ia|llm))\s{0,3}:`),
  P("fr", LABEL.address, B, String.raw`en${S}tant${S}que${S}mod[eè]le${S}de${S}langage`, E),
];

// ---------------------------------------------------------------------------
// German

const DE_USER = String.raw`(?:benutzer|nutzer|anwender|user)(?:in|innen|n|s)?`;
const DE_SECRET = String.raw`${B}(?:(?:api-?schl[uü]ssel${LAT}{0,2}|api[_ -]?keys?|tokens?|passw[oö]rter|passwort|kennw[oö]rter|kennwort|zugangsdaten|anmeldedaten|secrets?|geheimnisse|private[nr]?${S}schl[uü]ssel|ssh-?schl[uü]ssel${LAT}{0,2}|umgebungsvariablen?)${E}|\.env${E})`;
const DE_OLD = String.raw`(?:vorherigen|bisherigen|obigen|vorangegangenen|fr[uü]heren|urspr[uü]nglichen|alten|vorigen)`;
const DE_RULES = String.raw`(?:anweisungen|instruktionen|regeln|vorgaben|befehle|richtlinien|anordnungen)`;
const DE_ACT = String.raw`${B}(?:mach|pushe|sende|schicke|l[oö]sche|entferne|starte|installiere|[aä]ndere|schreibe|merge|ver[oö]ffentliche|deaktiviere|[uü]berschreibe|ersetze|erstelle|kopiere|verschiebe|genehmige|committe|deploye)(?:${S}sie)?${E}`;
const DE: HiddenPhrase[] = [
  P("de", LABEL.ignore, LEAD, B, String.raw`(?:ignorier(?:e|en|t)?|vergiss|vergesst|vergessen|missachte|missachten|verwirf|verwerfen|[uü]bergehe|[uü]bergehen)(?:${S}sie)?${S}(?:(?:alle|s[aä]mtliche|jegliche)${S})?(?:(?:die|deine|eure|ihre)${S})?(?:${DE_OLD}${S}${DE_RULES}|system-?anweisungen|system-?prompts?)`, E),
  P("de", LABEL.ignore, LEAD, B, String.raw`(?:(?:alle|s[aä]mtliche)${S})?(?:die${S})?${DE_OLD}${S}${DE_RULES}${S}(?:ignorieren|vergessen|missachten|verwerfen)\s{0,3}(?:[.!\n]|$)`),
  P("de", LABEL.ignore, LEAD, B, String.raw`(?:vergiss|vergesst|vergessen${S}sie)${S}alles,?${S}(?:bisherige|vorherige|obige|was${S}(?:dir${S}|euch${S}|ihnen${S})?(?:vorher|bisher|zuvor))`, E),
  P("de", LABEL.ignore, LEAD, B, String.raw`(?:halte${S}dich|halten${S}sie${S}sich)${S}nicht${S}(?:mehr${S})?an${S}(?:die|deine|ihre)${S}${DE_OLD}${S}${DE_RULES}`, E),
  P("de", LABEL.ignore, LEAD, B, String.raw`(?:befolge|befolgen${S}sie)${S}(?:die|deine|ihre)${S}${DE_OLD}${S}${DE_RULES}${S}nicht`, E),
  P("de", LABEL.hide, LEAD, B, String.raw`(?:sag|sage|sagt|sagen${S}sie|erz[aä]hl|erz[aä]hle|erz[aä]hlen${S}sie|erw[aä]hne|erw[aä]hnen${S}sie|verrate|verraten${S}sie)${S}(?:(?:es|das|dies|davon)${S})?(?:dem|der)${S}${DE_USER}${S}(?:(?:es|das|dies|davon)${S})?(?:nichts|nicht|niemals)`, E),
  P("de", LABEL.hide, LEAD, B, String.raw`(?:sag|sage|sagen${S}sie|erw[aä]hne|erw[aä]hnen${S}sie|verrate|verraten${S}sie)${S}(?:es|das|dies|davon|hiervon)${S}(?:nicht|niemals)${S}(?:gegen[uü]ber${S})?(?:dem|der)${S}${DE_USER}`, E),
  P("de", LABEL.hide, LEAD, B, String.raw`(?:verschweige|verschweigen${S}sie|verheimliche|verheimlichen${S}sie|verbirg|verbergen${S}sie)`, E, IN(40), B, String.raw`(?:dem|der|vor${S}dem|vor${S}der)${S}${DE_USER}`, E),
  P("de", LABEL.covert, covert(LEAD, DE_ACT, String.raw`${B}(?:heimlich|insgeheim|im${S}geheimen|hinter${S}dem${S}r[uü]cken${S}des${S}(?:benutzers|nutzers|anwenders)|ohne${S}(?:dass${S})?(?:der|die)${S}${DE_USER}${S}(?:es${S}|etwas${S}|davon${S})?(?:merkt|bemerkt|wei(?:ß|ss)|erf[aä]hrt|mitbekommt)|ohne${S}(?:den|die)${S}${DE_USER}${S}(?:zu${S})?(?:informieren|fragen|benachrichtigen|warnen)|ohne${S}wissen${S}des${S}(?:benutzers|nutzers|anwenders)|still${S}und${S}leise|stillschweigend)${E}`)),
  P("de", LABEL.run, LEAD, B, String.raw`(?:f[uü]hre|f[uü]hrt|f[uü]hren${S}sie)${S}(?:beliebige|jeden|jegliche|alle${S}m[oö]glichen)${S}(?:befehle?|kommandos?|skripte?|shell-?befehle?|code)${S}aus`, E),
  P("de", LABEL.secret, LEAD, B, String.raw`(?:sende|send|schicke|schick|sendet|schickt|senden${S}sie|schicken${S}sie|[uü]bermittle|[uü]bermitteln${S}sie|leite|leiten${S}sie|exfiltriere|verrate|verraten${S}sie)`, E, GAP(60), DE_SECRET),
  P("de", LABEL.address, B, String.raw`(?:du${S}bist|sie${S}sind)${S}(?:ein|eine)${S}(?:ki|ki-assistent${LAT}{0,2}|ki-agent${LAT}{0,2}|assistent${LAT}{0,2}|sprachmodell|bot|llm|chatbot)`, E),
  P("de", LABEL.address, B, String.raw`(?:hinweis|anweisungen?|notiz|nachricht)${S}(?:f[uü]r|an)${S}(?:die${S}ki|den${S}(?:agenten|assistenten|bot)|das${S}(?:modell|sprachmodell|llm))\s{0,3}:`),
];

// ---------------------------------------------------------------------------
// Russian (imperative forms differ from statements, so no clause opener is needed)

const RU_USER = String.raw`(?:пользовател|юзер)${CYR}{0,3}`;
const RU_SECRET = String.raw`${B}(?:(?:api[- ]?ключ${CYR}{0,3}|ключ${CYR}{0,3}${S}api|токен${CYR}{0,3}|парол${CYR}{1,3}|уч[её]тн${CYR}{1,3}${S}данн${CYR}{1,3}|секрет${CYR}{0,3}|приватн${CYR}{1,3}${S}ключ${CYR}{0,3}|закрыт${CYR}{1,3}${S}ключ${CYR}{0,3}|ssh[- ]?ключ${CYR}{0,3}|переменн${CYR}{1,3}${S}окружения)${E}|\.env${E})`;
const RU_ACT = String.raw`${B}(?:отправь|удали|запусти|выполни|установи|измени|добавь|запиши|опубликуй|отключи|перезапиши|замени|создай|скопируй|перемести|одобри|задеплой|закоммить|запушь|сделай|смержи|пошли|перешли|сотри)(?:те)?${E}`;
const RU: HiddenPhrase[] = [
  P("ru", LABEL.ignore, B, String.raw`(?:игнорируй(?:те)?|проигнорируй(?:те)?|забудь(?:те)?|не${S}обращай(?:те)?${S}внимани[ея]${S}на|отбрось(?:те)?|пренебреги(?:те)?)${S}(?:(?:все|всё)${S})?(?:предыдущ${CYR}{1,4}|прежн${CYR}{1,4}|прошл${CYR}{1,4}|вышеуказанн${CYR}{1,4}|вышеизложенн${CYR}{1,4}|системн${CYR}{1,4}|предшествующ${CYR}{1,4}|ранее${S}данн${CYR}{1,4}|исходн${CYR}{1,4})${S}(?:инструкци${CYR}{0,3}|указани${CYR}{0,3}|правил${CYR}{0,3}|команд${CYR}{0,3}|распоряжени${CYR}{0,3}|промпт${CYR}{0,3})`, E),
  P("ru", LABEL.ignore, B, String.raw`забудь(?:те)?${S}(?:всё|все),?${S}(?:что${S}(?:тебе|вам)${S}(?:говорили|сказали)|выше|предыдущее|сказанное${S}ранее)`, E),
  P("ru", LABEL.ignore, B, String.raw`не${S}(?:следуй|следуйте|выполняй|выполняйте|подчиняйся|подчиняйтесь|соблюдай|соблюдайте)${S}(?:(?:всем|все)${S})?(?:предыдущ${CYR}{1,4}|прежн${CYR}{1,4}|прошл${CYR}{1,4}|вышеуказанн${CYR}{1,4}|системн${CYR}{1,4}|исходн${CYR}{1,4})${S}(?:инструкци${CYR}{0,3}|указани${CYR}{0,3}|правил${CYR}{0,3}|команд${CYR}{0,3}|распоряжени${CYR}{0,3})`, E),
  P("ru", LABEL.hide, B, String.raw`не${S}(?:говори|говорите|сообщай|сообщайте|рассказывай|рассказывайте|упоминай|упоминайте|выдавай|выдавайте)`, E, IN(40), B, RU_USER, E),
  P("ru", LABEL.hide, B, RU_USER, S, String.raw`(?:об${S}этом${S}|ничего${S})?не${S}(?:говори|сообщай|рассказывай|упоминай)(?:те)?`, E),
  P("ru", LABEL.hide, B, String.raw`(?:скрой|скройте|утаи|утаите)`, E, IN(40), B, String.raw`от${S}`, RU_USER, E),
  P("ru", LABEL.covert, covert("", RU_ACT, String.raw`${B}(?:тайно|втайне|скрытно|украдкой|без${S}ведома${S}${RU_USER}|незаметно${S}для${S}${RU_USER}|так,?${S}чтобы${S}${RU_USER}${S}не${S}(?:знал|заметил|узнал|увидел)|не${S}(?:сообщая|говоря|спрашивая|уведомляя)${S}${RU_USER}|по-тихому|втихую|молча)${E}`)),
  P("ru", LABEL.run, B, String.raw`(?:выполни|выполните|запусти|запустите|исполни|исполните)${S}(?:любую|любые|любой|произвольн${CYR}{1,3}|все${S}возможные)${S}(?:команд${CYR}{0,3}|скрипт${CYR}{0,3}|код)`, E),
  P("ru", LABEL.secret, String.raw`(?<!не\s)`, B, String.raw`(?:отправь|отправьте|пошли|пошлите|перешли|перешлите|слей|слейте|опубликуй|опубликуйте|скинь|скиньте)`, E, GAP(60), RU_SECRET),
  P("ru", LABEL.address, B, String.raw`(?:ты|вы)${S}(?:[-\u2013\u2014]${S})?(?:ии|ии-ассистент${CYR}{0,2}|ии-агент${CYR}{0,2}|ассистент${CYR}{0,2}|агент${CYR}{0,2}|языков${CYR}{2,3}${S}модел${CYR}{1,2}|бот|llm|нейросеть)`, E),
  P("ru", LABEL.address, B, String.raw`(?:заметка|примечание|инструкци[яи]|сообщение|указани[ея]|записка)${S}(?:для|к)${S}(?:ии|агент${CYR}{0,2}|ассистент${CYR}{0,2}|модел${CYR}{0,2}|бот${CYR}{0,2}|llm|нейросет${CYR}{0,2})\s{0,3}:`),
];

// ---------------------------------------------------------------------------
// Chinese, simplified and traditional: fixed phrases, no word boundaries

const ZH_USER = "(?:用户|用戶|使用者)";
const ZH_NEG = "(?:不要|不准|不许|不許|不得|别|別|切勿|请勿|請勿|千万不要|千萬不要|绝对不要|絕對不要)";
const ZH_IGNORE = "(?:忽略|忽视|忽視|无视|無視|不要理会|不要理會|别理会|別理會|别管|別管|不用管|忘记|忘記|忘掉|抛开|拋開|丢弃|丟棄|不要遵守|不再遵守|不必遵守|无需遵守|無需遵守|不要遵循|不再遵循)(?:掉)?(?:你)?(?:所有|全部|一切)?(?:的)?";
const ZH_SECRET = String.raw`(?:api\s?(?:密钥|密鑰|key|令牌)|密钥|密鑰|访问令牌|訪問令牌|令牌|token|密码|密碼|口令|凭据|憑據|凭证|憑證|环境变量|環境變數|\.env|私钥|私鑰|ssh\s?(?:密钥|密鑰|key)|secret)`;
const ZH_SEND = "(?:发送|發送|发给|發給|发到|發到|上传|上傳|传到|傳到|泄露|洩露|外传|外傳|转发|轉發)";
const ZH_ACT = "(?:提交|推送|上传|上傳|发送|發送|删除|刪除|删掉|刪掉|修改|改掉|运行|運行|执行|執行|安装|安裝|下载|下載|合并|合併|写入|寫入|覆盖|覆蓋|替换|替換|关闭|關閉|禁用|部署|发布|發布|批准|植入|注入|更改|移除|push|commit|merge)";
const ZH_AI = "(?:ai|人工智能|助手|智能助手|ai助手|代理|智能体|智能體|语言模型|語言模型|大模型|大语言模型|大語言模型|机器人|機器人|llm|编程助手|編程助手)";
const ZH: HiddenPhrase[] = [
  P("zh", LABEL.ignore, LEAD_ZH, ZH_IGNORE, "(?:之前|以前|上面|先前|此前|前面|上述|原来|原來|原有|原先|系统|系統|过去|過去)(?:的)?(?:所有|全部|一切)?(?:的)?(?:指令|指示|提示词|提示詞|规则|規則|设定|設定|约束|約束)"),
  P("zh", LABEL.ignore, LEAD_ZH, ZH_IGNORE, "(?:之前|以前|先前|此前|原来|原來|原有|原先|系统|系統)(?:的)?(?:所有|全部|一切)?(?:的)?(?:说明|說明|提示)"),
  P("zh", LABEL.hide, LEAD_ZH, ZH_NEG, "(?:告诉|告訴|告知|透露给|透露給)", ZH_USER),
  P("zh", LABEL.hide, LEAD_ZH, ZH_NEG, "(?:向|对|對|跟|和|给|給)", ZH_USER, "(?:透露|提及|提起|提到|告知|说|說|讲|講)"),
  P("zh", LABEL.hide, LEAD_ZH, "(?:对|對|向)", ZH_USER, "(?:隐瞒|隱瞞)(?!了|过|過)"),
  P("zh", LABEL.covert, LEAD_ZH_SENT, "(?:偷偷地?|悄悄地?|秘密地|暗中|暗地里|暗地裡|瞒着", ZH_USER, "|瞞著", ZH_USER, "|背着", ZH_USER, "|背著", ZH_USER, "|在", ZH_USER, "(?:不知情|不知道|没有察觉|沒有察覺)的情[况況]下)[\uff0c,]?(?:把|将|將)?", String.raw`(?:(?![\u3002\uff0c\uff01\uff1f\n,])[^\n]){0,12}`, ZH_ACT),
  P("zh", LABEL.covert, LEAD_ZH_SENT, ZH_NEG, "(?:让|讓)", ZH_USER, "(?:知道|发现|發現|察觉|察覺)"),
  P("zh", LABEL.run, LEAD_ZH, String.raw`(?:执行|執行|运行|運行)(?:任何|任意)(?:的)?(?:命令|指令|脚本|腳本|shell\s?命令|代码|代碼)(?!前|之前|以前|时|時|的时候|的時候)`),
  P("zh", LABEL.secret, LEAD_ZH, String.raw`(?:把|将|將)(?:你的|所有的?|全部的?|这些|這些|当前的?|當前的?)?\s?`, ZH_SECRET, String.raw`(?:(?!请求头|請求頭|标头|標頭|header|authorization|bearer|[\u3002\uff0c\uff01\uff1f])[^\n]){0,20}`, ZH_SEND),
  P("zh", LABEL.secret, LEAD_ZH, "(?:发送|發送|上传|上傳|泄露|洩露|外传|外傳)(?:你的|所有的?|全部的?)?\\s?", ZH_SECRET, "\\s?(?:到|给|給|至)"),
  P("zh", LABEL.address, "你(?:是|现在是|現在是|将扮演|將扮演)(?:(?:一个|一個|一名|一位)[^\\n\u3002\uff0c,]{0,8})?", ZH_AI),
  P("zh", LABEL.address, String.raw`(?:给|給|致|写给|寫給)(?:ai|人工智能|助手|代理|智能体|智能體|模型|大模型|llm)的(?:提示|说明|說明|指令|备注|備註|注释|註釋|消息|訊息|话|話)\s?[:\uff1a]`),
];

// ---------------------------------------------------------------------------
// Japanese: imperative endings only. "して" counts when it ends the clause, so
// "無視して新しい設定を使う" (a description) does not match; "無視しても" never does.

const JA_USER = "(?:ユーザー|ユーザ|利用者|使用者)";
const JA_END = String.raw`(?=\s{0,2}(?:[\u3002\uff01!\u3001\uff0c,.\n]|$|ください|下さい))`;
const JA_DO = String.raw`(?:しろ|せよ|しなさい|してください|して下さい|すること(?=\s{0,2}(?:[\u3002\uff01!\n]|$))|して${JA_END})`;
/** Any verb in the imperative or as a request: "削除して\u3002", "送れ", "消してください". */
const JA_IMP = String.raw`(?:ください|下さい|しろ|せよ|なさい|すること(?=\s{0,2}(?:[\u3002\uff01!\n]|$))|[てで]${JA_END})`;
const JA_SECRET = String.raw`(?:api\s?キー|api[_ -]?key|アクセストークン|トークン|パスワード|認証情報|資格情報|クレデンシャル|シークレット|秘密鍵|秘密情報|プライベートキー|ssh\s?キー|ssh鍵|環境変数|\.env)`;
const JA: HiddenPhrase[] = [
  P("ja", LABEL.ignore, String.raw`(?:以前|前|上記|上|先|これまで|今まで|元|システム|最初)の(?:すべての|全ての|全部の)?(?:指示|命令|ルール|指令|プロンプト|制約|インストラクション)(?:は|を)?(?:すべて|全て|全部|一切)?\s?(?:無視${JA_DO}|忘れ(?:ろ|なさい|ること(?=\s{0,2}(?:[\u3002\uff01!\n]|$))|て${JA_END}))`),
  P("ja", LABEL.ignore, String.raw`(?:以前|前|上記|上|先|これまで|今まで|元|システム|最初)の(?:すべての|全ての|全部の)?(?:指示|命令|ルール|指令|プロンプト|制約)(?:は|に|には)?(?:もう)?(?:従わ|気にし)ないで(?=\s{0,2}(?:[\u3002\uff01!\u3001\uff0c,.\n]|$|ください|下さい))`),
  P("ja", LABEL.hide, JA_USER, String.raw`(?:に|へ)(?:は|も)?[^\n\u3002]{0,10}(?:言わ|伝え|知らせ|教え|話さ|報告し|明かさ)(?:ないで(?=\s{0,2}(?:[\u3002\uff01!\u3001\uff0c,.\n]|$|ください|下さい|ほしい))|るな|ずに[^\n\u3002]{0,20}${JA_IMP})`),
  P("ja", LABEL.hide, JA_USER, "(?:に|には)(?:秘密|内緒)(?:に|で|にして)"),
  P("ja", LABEL.hide, JA_USER, String.raw`から隠(?:して${JA_END}|せ(?=\s{0,2}(?:[\u3002\uff01!\n]|$))|しなさい|すこと(?=\s{0,2}(?:[\u3002\uff01!\n]|$)))`),
  P("ja", LABEL.covert, "(?:こっそり|密かに|ひそかに|内緒で|秘密裏に|黙って|", JA_USER, String.raw`(?:に)?(?:気づかれ|気付かれ|知られ|バレ)(?:ない(?:よう)?に?|ず))[^\n\u3002]{0,20}`, JA_IMP),
  P("ja", LABEL.run, String.raw`(?:任意の|あらゆる|どんな)(?:コマンド|シェルコマンド|スクリプト|コード)(?:でも|を)?(?:も)?\s?(?:実行|走ら)`, JA_DO),
  P("ja", LABEL.secret, JA_SECRET, String.raw`(?:ファイル|の内容|の値)?を(?:(?!ヘッダ|header|authorization|bearer|リクエスト)[^\n\u3002]){0,15}(?:(?:送信|送付|アップロード|投稿|転送)${JA_DO}|(?:送って|送れ|漏らして|漏らせ)(?!も))`),
  P("ja", LABEL.address, String.raw`(?:あなた|君|お前)は[^\n\u3002\u3001]{0,10}(?:ai|人工知能|アシスタント|エージェント|言語モデル|llm|ボット|チャットボット)(?:です|だ|である|として)`),
  P("ja", LABEL.address, String.raw`(?:ai|エージェント|アシスタント|llm)(?:へ|に向け|宛)(?:の|て)?(?:メモ|注意|指示|メッセージ|ノート)\s?[:\uff1a]`),
];

// ---------------------------------------------------------------------------
// Korean: imperative endings only; "무시해도" (you may ignore) never matches.

const KO_USER = "(?:사용자|유저|이용자)";
const KO_SECRET = String.raw`(?:api\s?키|api[_ -]?key|액세스\s?토큰|토큰|비밀번호|패스워드|자격\s?증명|인증\s?정보|시크릿|비밀\s?키|개인\s?키|프라이빗\s?키|ssh\s?키|환경\s?변수|\.env)`;
const KO_IMP = (stem: string): string => String.raw`(?:${stem}해(?:라|줘|주세요)|${stem}하(?:세요|십시오|라)|${stem}할\s?것)`;
/** Any verb in the imperative: "푸시해.", "삭제해라", "머지하세요", "보내라". Not "할 것입니다" (will do). */
const KO_ANY_IMP = String.raw`(?:해(?:라|줘|\s?주세요)|하(?:세요|십시오|라)|해(?=[\s.!,]|$)|라(?=[\s.!,]|$)|할\s?것(?=[\s.!,]|$))`;
const KO: HiddenPhrase[] = [
  P("ko", LABEL.ignore, BK, String.raw`(?:이전|앞|위|앞서|기존|원래|시스템|지금까지)(?:의)?\s?(?:모든\s?)?(?:지시\s?사항|지시|지침|명령어|명령|규칙|프롬프트|인스트럭션)(?:들)?(?:은|는|을|를)?\s?(?:모두\s?|전부\s?|다\s?)?(?:무시해(?:라|줘|주세요|요)(?![도서야])|무시해(?=[\s.!,]|$)|무시하(?:세요|십시오|라)|무시할\s?것|잊어(?:버려|라|줘|주세요)(?![도서야])|잊으(?:세요|십시오))`),
  P("ko", LABEL.ignore, BK, String.raw`(?:이전|앞|위|앞서|기존|원래|시스템|지금까지)(?:의)?\s?(?:모든\s?)?(?:지시\s?사항|지시|지침|명령어|명령|규칙|프롬프트)(?:들)?(?:은|는|을|를|에)?\s?(?:더\s?이상\s?)?(?:신경\s?쓰지|따르지)\s?(?:마세요|마십시오|마라|말아(?:라|줘)?|마(?=[\s.!,]|$))`),
  P("ko", LABEL.hide, BK, KO_USER, String.raw`(?:에게|한테|께)(?:는)?\s?[^\n.]{0,15}(?:말하지|알리지|알려주지|공개하지|언급하지|보고하지|전하지|밝히지)\s?(?:마세요|마십시오|마라|말아(?:라|줘|주세요)?|마(?=[\s.!,]|$))`),
  P("ko", LABEL.hide, BK, KO_USER, String.raw`(?:에게|한테|로부터)\s?(?:는\s?)?[^\n.]{0,15}(?:숨기(?:세요|십시오|라)|숨겨(?:라|줘|주세요))`),
  P("ko", LABEL.covert, BK, "(?:몰래|은밀히|은밀하게|비밀리에|", KO_USER, String.raw`\s?(?:모르게|몰래)|`, KO_USER, String.raw`(?:\uac00|이)\s?(?:모르게|눈치채지\s?못하게|알지\s?못하게|알아채지\s?못하게))[^\n.]{0,20}`, KO_ANY_IMP),
  P("ko", LABEL.run, BK, String.raw`(?:모든|임의의|어떤|아무)\s?(?:명령어|명령|스크립트|셸\s?명령어?|쉘\s?명령어?|코드)(?:이든|든지|라도)?(?:을|를)?\s?`, KO_IMP("실행")),
  P("ko", LABEL.secret, KO_SECRET, String.raw`(?:\s?(?:파일|값|내용|정보))?(?:을|를)\s?`, GAP(15), BK, String.raw`(?:보내(?:라|줘|주세요|세요|십시오)|${KO_IMP("전송")}|${KO_IMP("업로드")}|${KO_IMP("유출")})`),
  P("ko", LABEL.address, BK, String.raw`(?:너|당신|넌)(?:은|는)?\s?[^\n.]{0,12}(?:ai|인공지능|어시스턴트|비서|에이전트|언어\s?모델|llm|봇|챗봇)(?:이다|야|입니다|이야|이에요|예요|로서|으로서)`),
  P("ko", LABEL.address, String.raw`(?:ai|에이전트|어시스턴트|모델|llm)(?:에게|한테)\s?(?:보내는\s?|전하는\s?)?(?:메모|노트|지시|지침|메시지|안내)\s?[:\uff1a]`),
];

// ---------------------------------------------------------------------------
// Hindi (Devanagari, with the English loanwords people mix in). SOV order: the object comes first.

const HI_USER = String.raw`(?:उपयोगकर्ता|यूज\u093cर|यूजर|प्रयोगकर्ता|user)`;
const HI_DO = String.raw`(?:करो|करें|करिए|कीजिए|कर\s{0,2}दो|कर\s{0,2}दें)`;
/** Imperatives; not a bare "दो", which is also "two". */
const HI_IMP = String.raw`(?:${HI_DO}|(?:हटा|मिटा|भेज|डाल|चला|बदल|लिख|जोड़|दे)\s{0,2}(?:दो|दें)|भेजो|भेजें|हटाओ|हटाएं|हटाएँ|चलाओ|चलाएं|चलाएँ|डालो|डालें|बदलो|बदलें|लिखो|लिखें|जोड़ो|जोड़ें|मिटाओ|मिटाएं)${E}`;
const HI_SECRET = String.raw`${B}(?:api\s{0,2}(?:कुंजी|keys?)|एपीआई${S}कुंजी|api[_ -]?keys?|टोकन|tokens?|पासवर्ड|passwords?|क्रेडेंशियल्?स?|credentials?|सीक्रेट|secrets?|गुप्त${S}कुंजी|निजी${S}कुंजी|private${S}keys?|एनवायरनमेंट${S}वेरिएबल्?स?|environment${S}variables?|\.env)${E}`;
const HI: HiddenPhrase[] = [
  P("hi", LABEL.ignore, B, String.raw`(?:(?:सभी|सारे)${S})?(?:पिछले|पिछली|पहले${S}के|पहले${S}दिए${S}गए|ऊपर${S}(?:दिए${S}गए|के|लिखे${S}गए|लिखे)|पूर्व|मूल|सिस्टम|अब${S}तक${S}के)${S}(?:(?:सभी|सारे)${S})?(?:निर्देशों|निर्देश|नियमों|नियम|आदेशों|आदेश|instructions|प्रॉम्प्ट)${S}(?:को${S})?(?:(?:अनदेखा|नज\u093c?रअंदाज\u093c?|न\u095bरअंदा\u095b|इग्नोर|ignore)\s{0,4}${HI_DO}|भूल${S}(?:जाओ|जाएं|जाएँ|जाइए))`, E),
  P("hi", LABEL.ignore, B, String.raw`(?:(?:सभी|सारे)${S})?(?:पिछले|पिछली|पहले${S}के|पहले${S}दिए${S}गए|ऊपर${S}(?:दिए${S}गए|के|लिखे)|पूर्व|मूल|सिस्टम)${S}(?:(?:सभी|सारे)${S})?(?:निर्देशों|नियमों|आदेशों)${S}का${S}पालन${S}(?:मत|न|ना)${S}${HI_DO}`, E),
  P("hi", LABEL.hide, B, HI_USER, S, String.raw`(?:को|से)${S}${IN(30)}(?:मत|न|ना)${S}(?:बताओ|बताएं|बताएँ|बताना|बताइए|बताइये|बतलाओ|कहो|कहें|कहना)`, E),
  P("hi", LABEL.hide, B, HI_USER, S, String.raw`से${S}${IN(20)}(?:छिपाओ|छिपाएं|छिपाएँ|छिपाइए|छुपाओ|छुपाएं|छुपाएँ|छुपाइए)`, E),
  P("hi", LABEL.covert, B, String.raw`(?:चुपके${S}से|छिपकर|छुपकर|गुप्त${S}रूप${S}से|बिना${S}बताए|${HI_USER}${S}(?:को${S})?बताए${S}बिना|${HI_USER}${S}की${S}जानकारी${S}के${S}बिना|${HI_USER}${S}को${S}पता${S}(?:चले|लगे)${S}बिना)`, E, IN(40), HI_IMP),
  P("hi", LABEL.run, B, String.raw`(?:कोई${S}भी|किसी${S}भी)${S}(?:कमांड|आदेश|स्क्रिप्ट|command|कोड)${S}(?:को${S})?(?:चलाओ|चलाएं|चलाएँ|चलाइए|रन${S}(?:करो|करें)|run${S}(?:करो|करें)|execute${S}(?:करो|करें)|निष्पादित${S}(?:करो|करें))`, E),
  P("hi", LABEL.secret, HI_SECRET, String.raw`\s{0,4}(?:को${S})?`, GAP(40), String.raw`(?<!मत\s)(?<!न\s)(?<!ना\s)(?:भेजो|भेजें|भेजिए|भेज\s{0,2}दो|भेज\s{0,2}दें|अपलोड${S}${HI_DO}|लीक${S}${HI_DO}|पोस्ट${S}${HI_DO}|send${S}${HI_DO})`, E),
  P("hi", LABEL.address, B, String.raw`(?:तुम|आप)${S}(?:एक${S})?(?:[^\n\u0964]{0,15}${S})?(?:ai|एआई|सहायक|असिस्टेंट|एजेंट|भाषा${S}मॉडल|बॉट|llm|चैटबॉट)(?:${S}(?:सहायक|असिस्टेंट|एजेंट))?${S}(?:हो|हैं)`, E),
  P("hi", LABEL.address, B, String.raw`(?:ai|एआई|एजेंट|सहायक|असिस्टेंट|मॉडल|llm)${S}के${S}लिए${S}(?:नोट|निर्देश|सूचना|संदेश)\s{0,3}[:\uff1a]`),
];

/**
 * Scripts each language needs: a comment with no Han, kana, Hangul, Cyrillic or Devanagari skips
 * those languages entirely. One pass over the text, so most comments cost a few regex tests, not ninety.
 * Bits: 1 Han, 2 kana, 4 Hangul, 8 Cyrillic, 16 Devanagari. Latin-script languages always run.
 */
export function scriptsIn(t: string): number {
  let m = 0;
  for (let i = 0; i < t.length && m !== 31; i++) {
    const c = t.charCodeAt(i);
    if (c < 0x400) continue;
    if (c <= 0x4ff) m |= 8;
    else if (c >= 0x900 && c <= 0x97f) m |= 16;
    else if (c >= 0x3040 && c <= 0x30ff) m |= 2;
    else if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) m |= 1;
    else if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f)) m |= 4;
  }
  return m;
}

/** The script bits a language needs (any one of them), 0 for none. */
export const LANG_SCRIPTS: Record<HiddenLang, number> = { es: 0, fr: 0, de: 0, pt: 0, zh: 1, ja: 3, ko: 4, ru: 8, hi: 16 };

/** Every phrase, dangerous ones before the ones that only address the AI. */
export const HIDDEN_PHRASES: readonly HiddenPhrase[] = (() => {
  const all = [...ES, ...PT, ...FR, ...DE, ...RU, ...ZH, ...JA, ...KO, ...HI];
  return [...all.filter((p) => p.label !== LABEL.address), ...all.filter((p) => p.label === LABEL.address)];
})();
