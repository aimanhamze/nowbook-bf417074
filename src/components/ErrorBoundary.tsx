import { Component, type ReactNode } from "react";
import { useLang } from "@/contexts/LangContext";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

function ErrorFallback({ onReset }: { onReset: () => void }) {
  const { t } = useLang();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 text-center">
      <p className="text-4xl mb-4">😵</p>
      <h1 className="text-xl font-bold mb-2">{t("errorTitle")}</h1>
      <p className="text-sm text-muted-foreground mb-6">{t("errorBody")}</p>
      <button
        onClick={onReset}
        className="px-6 py-2.5 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold"
      >
        {t("goHome")}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          onReset={() => {
            this.setState({ hasError: false });
            window.location.href = "/";
          }}
        />
      );
    }

    return this.props.children;
  }
}
