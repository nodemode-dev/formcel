const KEYWORDS = new Set(
  `AddressOf Alias And As Boolean ByRef Byte ByVal Call Case CBool CByte CCur CDate CDbl CDec CInt CLng CLngLng CLngPtr CObj Const CSng CStr Currency CVar CVErr Date Declare DefBool DefByte DefCur DefDate DefDbl DefInt DefLng DefObj DefSng DefStr DefVar Dim Do Double Each Else ElseIf Empty End Enum Eqv Erase Error Event Exit False For Friend Function Get Global GoSub GoTo If Imp Implements In Input Integer Is Let Lib Like Long LongLong LongPtr Loop LSet Me Mod New Next Not Nothing Null Object On Open Option Optional Or ParamArray Preserve Print Private Property Public RaiseEvent ReDim Rem Resume Return RSet Select Set Single Static Step Stop String Sub Then To True Type TypeOf Until Variant Wend While With WithEvents Write Xor`
    .toLowerCase()
    .split(/\s+/),
);

const OBJECTS = new Set('application activeworkbook activesheet activecell selection range cells rows columns worksheets sheets workbooks thisworkbook debug msgbox inputbox'.split(' '));

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightLine(line: string): string {
  let out = '';
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    if (ch === "'") {
      out += `<span class="vc">${esc(line.slice(i))}</span>`;
      break;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += `<span class="vs">${esc(line.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    if (ch === '#' && /^#[^#]*#/.test(line.slice(i))) {
      const m = /^#[^#]*#/.exec(line.slice(i))!;
      out += `<span class="vn">${esc(m[0])}</span>`;
      i += m[0].length;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '&' && /^&[HhOo][0-9A-Fa-f]+/.test(line.slice(i)))) {
      const m = /^(?:&[HhOo][0-9A-Fa-f]+&?|\d+\.?\d*(?:[Ee][+-]?\d+)?[#!&%@^]?)/.exec(line.slice(i));
      if (m) {
        out += `<span class="vn">${esc(m[0])}</span>`;
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      const low = word.toLowerCase();
      if (low === 'rem' && /^\s*$/.test(line.slice(0, i))) {
        out += `<span class="vc">${esc(line.slice(i))}</span>`;
        break;
      }
      const prev = line[i - 1];
      if (prev !== '.' && KEYWORDS.has(low)) out += `<span class="vk">${esc(word)}</span>`;
      else if (prev !== '.' && OBJECTS.has(low)) out += `<span class="vo">${esc(word)}</span>`;
      else out += esc(word);
      i = j;
      continue;
    }
    out += esc(ch);
    i++;
  }
  return out || '&#8203;';
}

const OPEN = /^\s*(?:(?:Public|Private|Friend|Static)\s+)*(?:Sub|Function|Property\s+(?:Get|Let|Set))\b|^\s*For\b|^\s*Do\b|^\s*While\b|^\s*With\b|^\s*Select\s+Case\b|^\s*Else(?:If\b.*)?\s*$|^\s*Case\b|^\s*(?:(?:Public|Private)\s+)?(?:Type|Enum)\b/i;

export function indentAfter(line: string): string {
  const lead = /^[ \t]*/.exec(line)![0];
  const code = line.replace(/'.*$/, '');
  if (OPEN.test(code) && !/^\s*Exit\b/i.test(code) && !/^\s*For\b.*\bNext\b/i.test(code)) return lead + '    ';
  if (/^\s*If\b.*\bThen\s*$/i.test(code) || /^\s*ElseIf\b.*\bThen\s*$/i.test(code)) return lead + '    ';
  return lead;
}

export function dedentFor(line: string): boolean {
  return /^\s*(End\s+(Sub|Function|Property|If|With|Select|Type|Enum)|Next\b|Loop\b|Wend\b|Else\b|ElseIf\b|Case\b)/i.test(line);
}
