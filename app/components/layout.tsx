import { Outlet } from "react-router";
import { Provider } from "jotai";

export default function Layout() {
  return (
    <Provider>
      <main className="font-mono">
        <Outlet />
      </main>
    </Provider>
  );
}
