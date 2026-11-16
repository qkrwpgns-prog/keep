"""증거 묶음 PDF용 폰트 만들기 (한 번 실행해 public/fonts에 커밋)
- 원본: 나눔명조·나눔고딕 Regular (NHN, SIL OFL 1.1) — @expo-google-fonts 패키지에 든 구글 폰트 원본
- 한글 완성형·자모, 영문·숫자, 자주 쓰는 문장부호만 남기고(용량↓) GPOS/GSUB를 뺀다(pdf-lib fontkit 호환)
- OFL의 예약 글꼴 이름(Nanum…)을 수정본에 쓸 수 없어 이름을 Keep Serif / Keep Sans로 바꾼다
실행: pip install fonttools && python3 scripts/make-pdf-fonts.py
"""
from fontTools.ttLib import TTFont
from fontTools import subset

SRC = {
    'KeepSerif': 'node_modules/@expo-google-fonts/nanum-myeongjo/400Regular/NanumMyeongjo_400Regular.ttf',
    'KeepSans': 'node_modules/@expo-google-fonts/nanum-gothic/400Regular/NanumGothic_400Regular.ttf',
}
UNICODES = 'U+0020-007E,U+00A0-00FF,U+2000-206F,U+2190-21FF,U+2460-24FF,U+25A0-25FF,U+2713,U+3000-303F,U+3130-318F,U+AC00-D7A3,U+FF01-FF5E'

for name, path in SRC.items():
    font = TTFont(path)
    opts = subset.Options()
    opts.drop_tables += ['GPOS', 'GSUB']
    opts.hinting = False
    opts.name_IDs = ['*']
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    family = 'Keep Serif' if name == 'KeepSerif' else 'Keep Sans'
    for rec in font['name'].names:
        if rec.nameID in (1, 16):
            rec.string = family
        elif rec.nameID in (4,):
            rec.string = f'{family} Regular'
        elif rec.nameID in (3,):
            rec.string = f'{name}-Regular;derived-from-Nanum-OFL'
        elif rec.nameID in (6,):
            rec.string = f'{name}-Regular'
    font.save(f'public/fonts/{name}-Regular.ttf')
    print('saved', name)
