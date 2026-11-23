// 개인정보 처리 안내 (수업 과제용 시연 서비스 기준)
import { go } from '../lib/router';

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <tr><th style={{ textAlign: 'left', verticalAlign: 'top', padding: '8px 6px', width: '30%', borderTop: '1px solid var(--line)', fontSize: 13 }}>{k}</th><td style={{ padding: '8px 6px', borderTop: '1px solid var(--line)', fontSize: 13.5 }}>{children}</td></tr>
);

export function Privacy() {
  return (
    <>
      <div className="row between" style={{ marginTop: 8 }}><button className="btn small ghost" onClick={() => history.length > 1 ? history.back() : go('/')}>← 돌아가기</button></div>
      <h1>개인정보 처리 안내</h1>
      <div className="notice">키프는 대학 수업(멀티모달콘텐츠) 과제로 만든 시연 서비스예요. 실제 금전 거래의 유일한 증거로 쓰지 말고, 원본 대화와 송금 내역을 함께 보관해 주세요.</div>

      <div className="card">
        <h2>무엇을, 왜 모으나요</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
          <Row k="로그인">이메일 주소 — 본인 확인, 같은 약속을 어느 기기에서나 보기</Row>
          <Row k="증서">증서에 적은 이름, 약속 내용(금액·물건·할 일·기한·방법), 받을 계좌(선택) — 약속증서 작성·서명</Row>
          <Row k="서명 기록">손글씨 서명, 서명·동의 시각, 접속 IP, 기기 정보 — 누가 언제 서명했는지 증거로 남기기, 위변조 검사</Row>
          <Row k="알림">알림 이메일, 이 기기 푸시 구독 정보 — 기한 알림·재촉 보내기</Row>
          <Row k="첨부(선택)">카톡 캡처, 송금 완료 캡처 — AI 정리, 이행 확인</Row>
        </tbody></table>
        <p className="faint" style={{ marginTop: 8 }}>휴대폰 번호, 주민등록번호, 주소는 받지 않아요. 계좌번호는 화면과 증서에서 가운데 숫자를 가려요.</p>
      </div>

      <div className="card">
        <h2>다른 회사에 맡기는 일 (처리위탁)</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
          <Row k="Supabase">데이터베이스·로그인·파일 저장, 서버 기능 실행</Row>
          <Row k="Google(Gmail)">로그인 코드·알림 이메일 발송</Row>
          <Row k="Anthropic">AI 기능(대화 정리, 재촉 문구, 송금 캡처 읽기, 촉구서 초안)</Row>
          <Row k="GitHub Pages">웹앱 화면 제공(개인정보는 저장하지 않음)</Row>
        </tbody></table>
      </div>

      <div className="card">
        <h2>국외로 보내는 정보</h2>
        <p>AI 기능을 쓸 때만, 그 기능에 필요한 내용이 <b>미국 Anthropic</b>으로 전송돼요.</p>
        <ul style={{ paddingLeft: 18, margin: '6px 0', fontSize: 14 }}>
          <li>대화 정리: 붙여넣은 대화 글 또는 카톡 캡처, 작성자 이름</li>
          <li>재촉 문구·촉구서 초안: 약속 내용, 당사자 이름, 이전에 보낸 재촉 문구</li>
          <li>송금 캡처 읽기: 올린 송금 완료 화면</li>
        </ul>
        <p className="faint">계좌번호·IP·서명은 보내지 않아요. AI를 쓰고 싶지 않으면 로그인하지 않은 상태로 초안을 쓰거나 '직접 입력'을 고르면 기본 규칙으로만 정리해요.</p>
      </div>

      <div className="card">
        <h2>얼마나 보관하나요</h2>
        <ul style={{ paddingLeft: 18, margin: 0, fontSize: 14 }}>
          <li>탈퇴하면 바로 지워요(설정 → 탈퇴).</li>
          <li>상대가 서명을 마치지 않은 약속은 탈퇴와 함께 지워요.</li>
          <li>양쪽이 서명한 증서는 상대방의 증거라서 남기되, 내 계정 연결·알림 이메일·푸시 구독은 지우고 IP·기기 정보는 줄여서 보관해요. 완료된 약속은 완료 후 1년, 끝나지 않은 약속은 기한 후 10년이 지나면 지워요.</li>
          <li>알림 발송 기록은 90일 뒤 지워요.</li>
        </ul>
      </div>

      <div className="card">
        <h2>내 권리</h2>
        <p style={{ fontSize: 14 }}>내 약속과 기록은 언제든 앱에서 보고, 증서 파일·증거 묶음으로 내려받을 수 있어요. 수집·이용 동의를 거부할 수 있지만, 그러면 증서에 서명할 수 없어요. 만 14세 미만은 이용할 수 없어요.</p>
      </div>
    </>
  );
}
