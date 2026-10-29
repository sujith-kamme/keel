import { Chat } from "./chat";

export default function HelpPage() {
  return (
    <main className="shop-main" style={{ maxWidth: 720 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: 32, lineHeight: "40px", fontWeight: 500 }}>
        Help
      </h1>
      <Chat />
    </main>
  );
}
