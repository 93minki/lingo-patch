export const strings = {
  progress: {
    translating(completed: number, requested: number) {
      return `번역 중 · ${completed} / ${requested}`;
    },
    done: '번역 완료',
    openSettings: '설정 열기',
    authError: 'API 키를 확인하세요',
    unconfigured: '번역 설정이 필요합니다',
    rateLimit: '요청 한도 초과 · 잠시 후 다시 시도합니다',
    partialFailure: '일부 문단을 번역하지 못했습니다',
  },
  popup: {
    title: 'lingo-patch',
    loading: '불러오는 중…',
    checking: '확인 중…',
    unavailable: '이 페이지는 번역할 수 없습니다',
    needPageAccess:
      '이 확장이 이 사이트에 접근할 권한이 없습니다. 허용하면 번역할 수 있습니다.',
    allowThisSite: '이 사이트 접근 허용',
    allowAllSites: '모든 사이트 허용',
    configure: '번역 설정하기',
    autoSite: '이 사이트 항상 번역',
    translateOn: '지금 번역',
    translateOff: '번역 끄기',
    displayMode: '표시 모드',
    modeBilingual: '이중 언어',
    modeTranslation: '번역문만',
    modeOriginal: '원문만',
    retranslate: '이 페이지 다시 번역',
    retranslateConfirm(count: number) {
      return `이 페이지의 번역 ${count}개를 다시 요청합니다. 계속할까요?`;
    },
    statsTotal: '문단',
    statsRestored: '캐시 복원',
    statsTranslated: '새 번역',
    statsPending: '남음',
    statsSection: '페이지 통계',
    pageNoRequests: '이 페이지: 새 요청 없음(캐시)',
    pageTokens: (input: string, output: string) =>
      `이 페이지 토큰: 입력 ${input} · 출력 ${output}`,
    settings: '설정',
    settingsBack: '← 뒤로',
    settingsScreen: '번역 설정',
    freeKeyHint:
      'Google AI Studio에서 Gemini API 키를 발급해 아래에 붙여 넣을 수 있습니다.',
    freeKeyAdvanced: '다른 무료 선택지는 고급 설정에서 확인하세요.',
    customEngineGuide:
      '직접 입력(OpenAI 호환)은 고급 설정 페이지에서 구성할 수 있습니다.',
    openAdvancedOptions: '고급 설정 열기',
    advancedSettingsLink: '고급 설정 (자동 번역 사이트, 캐시, 단축키)',
    requestFailed: '요청에 실패했습니다',
    retry: '다시 시도',
  },
  options: {
    title: 'lingo-patch 설정',
    usage: '사용량',
    usageToday: '오늘',
    usage7: '최근 7일',
    usage30: '최근 30일',
    usageProvider: '공급자',
    usageModel: '모델',
    usageRequests: '요청',
    usageInput: '입력',
    usageOutput: '출력',
    usageClear: '기록 초기화',
    usageClearConfirm: '사용량 기록을 모두 삭제할까요?',
    usageNotice:
      '토큰 수는 각 AI 제공자가 응답에 알려준 값입니다. 요금은 제공자 콘솔에서 확인하세요.',
    loading: '설정을 불러오는 중…',
    requestFailed: '요청에 실패했습니다',
    save: '저장',
    saved: '저장했습니다',
    validateKey: '키 확인',
    validating: '확인 중…',
    validateOk: '키가 확인되었습니다',
    showKey: '키 보기',
    hideKey: '키 숨기기',
    apiKey: 'API 키',
    model: '모델',
    baseUrl: 'Base URL',
    engine: '번역 엔진',
    engineOpenai: 'OpenAI',
    engineAnthropic: 'Anthropic',
    engineGemini: 'Gemini',
    engineDeepseek: 'DeepSeek',
    engineGroq: 'Groq',
    engineOpenrouter: 'OpenRouter',
    engineCustom: '직접 입력 (OpenAI 호환)',
    freeModelsOnly: '무료 모델만 보기',
    privacy:
      'API 키는 브라우저 로컬 저장소의 별도 항목에 저장되며, 선택한 AI 제공자로만 전송됩니다. 암호화되지 않은 평문입니다.',
    deleteKey: '키 삭제',
    deleteKeyConfirm(providerName: string) {
      return `저장된 ${providerName} API 키를 삭제할까요? 삭제하면 번역이 중지됩니다.`;
    },
    keyDeleted: 'API 키를 삭제했습니다.',
    clearAllKeys: '저장된 모든 API 키 삭제',
    clearAllKeysConfirm:
      '모든 제공자·프리셋에 저장된 API 키를 삭제할까요? 번역 엔진·모델 설정은 유지되며, 새 번역은 키가 없으면 중지됩니다.',
    limitsIntro:
      '키가 유출돼도 피해를 줄이려면 제공자 콘솔에서 사용 한도를 설정하세요.',
    limitsHintPopup:
      '키 유출 대비: 제공자 콘솔에서 API 사용 한도를 설정하세요.',
    limitsOpenAi:
      'OpenAI: 프로젝트 전용 키와 월 예산 한도(더 강한 한도는 별도 설정)',
    limitsAnthropic:
      'Anthropic: 워크스페이스 지출 한도(default workspace 조건 확인)',
    limitsGemini: 'Gemini: AI Studio에서 Generative Language API만 허용',
    freeTierNotice: '무료 등급은 입력이 서비스 개선에 사용될 수 있습니다.',
    onboardingFreeTitle: '무료로 시작',
    onboardingFreeGemini1: 'Google AI Studio에서 Gemini API 키를 발급합니다.',
    onboardingFreeGemini2: '아래에서 Gemini를 선택하고 키를 붙여 넣습니다.',
    onboardingFreeGemini3: '「키 확인」으로 연결을 검증한 뒤 모델을 고릅니다.',
    onboardingAlt: '대안:',
    onboardingPaidTitle: '더 좋은 품질',
    onboardingPaidBody:
      'OpenAI, Anthropic, DeepSeek 유료 키를 사용할 수 있습니다.',
    translation: '번역',
    targetLang: '목표 언어',
    defaultDisplayMode: '기본 표시 모드',
    langKo: '한국어',
    langEn: '영어',
    langJa: '일본어',
    langZh: '중국어(간체)',
    autoSites: '자동 번역 사이트',
    addSite: '추가',
    addSiteLabel: 'hostname 추가',
    removeSite: '삭제',
    invalidSite: 'hostname만 입력하세요 (소문자, 경로·포트 없음).',
    sitePlaceholder: 'example.com',
    cache: '캐시',
    cacheUsage(count: number, mb: string, percent: number) {
      return `${count}개 문단 · ${mb} MB (${percent}%)`;
    },
    cacheTtl: '보관 기간(일)',
    cacheMaxMb: '용량 상한(MB)',
    deleteSiteCache: '사이트별 삭제',
    deleteSitePlaceholder: 'https://example.com',
    clearCache: '전체 삭제',
    clearCacheConfirm: '모든 번역 캐시를 삭제할까요?',
    advanced: '고급',
    skipFixedBars: '상단 고정 바 건너뛰기',
    skipFixedBarsHint:
      '높이가 낮은 sticky·fixed 헤더·툴바 안의 문장은 번역하지 않습니다.',
    shortcuts: '단축키',
    shortcutsHint:
      '브라우저 확장 프로그램 단축키 설정에서 Alt+A, Alt+S 등을 변경할 수 있습니다.',
    shortcutsPage: '단축키 설정 열기',
    permissionDenied: '호스트 권한이 거부되어 저장하지 않았습니다.',
    allowApiAccess: 'API 접근 허용',
    pickModel: '모델을 선택하세요',
    validateModelsFirst: '「키 확인」을 실행한 뒤 모델을 선택하세요.',
    invalidKey: 'API 키를 입력하세요.',
    invalidCache: '양의 유한 숫자만 입력할 수 있습니다.',
    loadError: '설정을 불러오지 못했습니다.',
    retry: '다시 시도',
    validationFailed: '키 확인에 실패했습니다',
    validationAuth: 'API 키를 확인하세요',
    validationNetwork: '네트워크 오류',
    validationOther: '키를 확인할 수 없습니다',
    noCommands: '등록된 단축키가 없습니다',
    commandToggleTranslate: '페이지 번역 켜기/끄기',
    commandCycleMode: '표시 모드 전환',
  },
} as const;

export function commandLabel(name?: string): string {
  if (name === 'toggle-translate')
    return strings.options.commandToggleTranslate;
  if (name === 'cycle-mode') return strings.options.commandCycleMode;
  return name ?? strings.options.noCommands;
}

export type ProgressErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'bad_request'
  | 'invalid_response'
  | 'aborted'
  | 'unconfigured';

export function progressErrorCopy(kind: ProgressErrorKind): {
  message: string;
  showSettingsLink: boolean;
} {
  if (kind === 'auth')
    return { message: strings.progress.authError, showSettingsLink: true };
  if (kind === 'unconfigured')
    return { message: strings.progress.unconfigured, showSettingsLink: true };
  if (kind === 'rate_limit')
    return { message: strings.progress.rateLimit, showSettingsLink: false };
  return { message: strings.progress.partialFailure, showSettingsLink: false };
}
