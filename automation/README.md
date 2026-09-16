# 가격 갱신과 Pages 배포

원본 workflow는 allocation-pages.yml, 게시 저장소에는 .github/workflows/allocation-pages.yml로 복사한다.
수집기/설정/고정 의존성은 게시 저장소 automation/에 복사한다. 개인 입력·원본 인스타 DB는 복사하지 않는다.
매일 22:20 UTC(한국 07:20), main의 기존 Pages 배포 성공 후, 수동 실행을 지원한다. 예약 시각은 GitHub 부하에 따라 지연될 수 있다.
읽기 전용 checkout에서 가격과 환율을 갱신한 후 전체 기존 정적 사이트를 Pages artifact로 배포한다.
봇 commit/push를 하지 않아 기존 로컬 게시 checkout과 Git 충돌을 만들지 않는다.
다운로드·검증 실패 시 배포 단계에 도달하지 않으므로 서비스의 마지막 성공 자료가 유지된다.
사이트 전체가 이 workflow를 사용한다. 기존 인스타 업데이트 push도 동일 workflow로 배포한다.
Score는 이 workflow에서 재계산하지 않는다. 기존 인스타 엔진→export_pages가 비공개 금액을 제외한
score-history.json을 만든다. 컴퓨터의 인스타 작업이 실행되지 않으면 Score도 추가되지 않는다.
기존 main 브랜치 Pages 설정을 유지한다. 기존 `pages build and deployment`가 성공한 후 workflow_run으로
수집·재배포하므로 두 배포의 완료 순서가 뒤집히지 않는다. 예약 실행은 독립적으로 수집·배포한다.
실행 결과는 GitHub Actions에서 확인한다.
공식 근거: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
