const paragraphs = [
  ['A quieter way to explore the web', '웹을 더 차분하게 탐색하는 방법'],
  [
    'Good ideas often begin with a simple question: what would happen if we paid closer attention? On a morning walk, familiar streets can reveal small details we had never noticed before.',
    '좋은 생각은 종종 단순한 질문에서 시작합니다. 조금 더 주의 깊게 살펴보면 어떤 일이 일어날까요? 아침 산책을 하다 보면 익숙한 거리에서도 전에는 보지 못했던 작은 모습이 눈에 들어옵니다.',
  ],
  [
    'The same is true when we read. A thoughtful article can connect an everyday observation to a much larger story, giving us a fresh way to understand the world around us.',
    '독서도 마찬가지입니다. 깊이 있는 글은 일상의 관찰을 더 큰 이야기와 연결하고, 우리 주변의 세상을 새롭게 이해할 방법을 알려줍니다.',
  ],
  ['Make room for curiosity', '호기심을 위한 시간 만들기'],
  [
    'Instead of rushing from one page to the next, take a moment to follow an interesting idea. Write down a question, compare different perspectives, and return when you are ready to learn more.',
    '한 페이지에서 다음 페이지로 서둘러 넘어가기보다 흥미로운 생각을 잠시 따라가 보세요. 질문을 적고, 여러 관점을 비교하고, 더 알고 싶을 때 다시 찾아오세요.',
  ],
  [
    'Reading across languages opens even more doors. With the original text and a translation side by side, you can follow the author’s words while building confidence in a new language.',
    '여러 언어로 읽으면 더 많은 가능성이 열립니다. 원문과 번역문을 함께 보면 글쓴이의 표현을 따라가면서 새로운 언어에 대한 자신감도 키울 수 있습니다.',
  ],
];
export const translations = Object.fromEntries(paragraphs);
export const article = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Field Notes — A quieter way to explore the web</title><style>
*{box-sizing:border-box} body{margin:0;color:#253438;background:#f5f7f5;font-family:system-ui,-apple-system,sans-serif} header{height:70px;background:white;border-bottom:1px solid #e3e9e5;display:flex;align-items:center;justify-content:space-between;padding:0 88px} .brand{font-size:19px;font-weight:750;letter-spacing:.02em;color:#194f45} nav{font-size:14px;color:#657770;word-spacing:28px} main{max-width:1020px;margin:46px auto;display:grid;grid-template-columns:1fr 200px;gap:70px} article{background:white;border:1px solid #e5ebe7;border-radius:12px;padding:38px 48px;box-shadow:0 8px 30px #244e3910} .eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;color:#397b68;text-transform:uppercase} h1{font-size:32px;line-height:1.2;margin:14px 0 22px;letter-spacing:-.03em} h2{font-size:22px;margin:28px 0 12px} p{font-size:15px;line-height:1.65;margin:0 0 17px;color:#40514e} aside{padding-top:24px;color:#778881;font-size:13px;line-height:1.8} aside strong{color:#3d5c51} lp-t{color:#397664}
</style></head><body><header translate="no"><div class="brand">◈ &nbsp;FIELD NOTES</div><nav>Stories &nbsp; Reading &nbsp; About</nav></header><main><article><div class="eyebrow" translate="no">Ideas for everyday life &nbsp; / &nbsp; 6 min read</div><h1>${paragraphs[0][0]}</h1><p>${paragraphs[1][0]}</p><p>${paragraphs[2][0]}</p><h2>${paragraphs[3][0]}</h2><p>${paragraphs[4][0]}</p><p>${paragraphs[5][0]}</p></article><aside translate="no"><strong>IN THIS STORY</strong><br>Finding new perspectives<br>Make room for curiosity<br><br><strong>FIELD NOTES</strong><br>Small ideas for a more thoughtful day.</aside></main></body></html>`;
