"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0e27] text-white">
      <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
      <p className="text-gray-400 mb-6">{error.message}</p>
      <button
        onClick={reset}
        className="px-6 py-2 bg-[#FFD208] text-black rounded-lg font-semibold hover:bg-[#e6bc07] transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
