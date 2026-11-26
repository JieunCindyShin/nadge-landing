# 냈지 NADGE

> 마감이 쏟아질 때, 냈지?

**👉 페이지 보기: https://nadge-landing.parallax.kr**

공모전 마감, 발표일, 제출 파일을 챙겨주는 앱 "냈지"의 랜딩 페이지예요. Parallax 해커톤 「랜딩톤」 출품작이에요. [Parallax Cloud](https://cloud.parallax.kr)로 배포했어요.

## 둘러보기

- 첫 화면의 마감 카드를 잡아서 던져보세요.
- 휴대폰으로 열면 "폰 기울이기"로 카드를 쏠리게 할 수 있어요.
- 스크롤하면 흩어진 카드가 휴대폰 화면 속 목록으로 정리돼요.

## 실행하기

빌드 과정 없이 `index.html`, `style.css`, `main.js` 세 파일로 돌아가요.

```bash
python3 -m http.server 4321
```

브라우저에서 http://localhost:4321 을 열어요.

## 사용한 것

- 물리 엔진: [Matter.js](https://brm.io/matter-js/) 0.19.0 (MIT)
- 스크롤 애니메이션: [GSAP](https://gsap.com/) 3.12.5 + ScrollTrigger (무료 표준 라이선스)
- 글꼴: [Pretendard](https://github.com/orioncactus/pretendard) (SIL OFL 1.1)
- 페이지 제작에 AI(Claude)를 활용했어요.

화면 속 공모전 이름은 모두 예시예요.
