import { useAccount, useSwitchChain } from "wagmi";
import { ArrowsRightLeftIcon } from "@heroicons/react/24/solid";
import { getTargetNetworks } from "~~/utils/helper";

const allowedNetworks = getTargetNetworks();

const COMING_SOON = [1];

type NetworkOptionsProps = {
  hidden?: boolean;
};

export const NetworkOptions = ({ hidden = false }: NetworkOptionsProps) => {
  const { switchChain } = useSwitchChain();
  const { chain } = useAccount();

  return (
    <>
      {allowedNetworks
        .filter(allowedNetwork => allowedNetwork.id !== chain?.id)
        .map(allowedNetwork => {
          const disabled = COMING_SOON.includes(allowedNetwork.id);
          return (
            <li key={allowedNetwork.id} className={hidden ? "hidden" : ""}>
              <button
                className={`menu-item btn-sm rounded-xl! flex gap-3 py-3 whitespace-nowrap ${
                  disabled ? "opacity-40 cursor-not-allowed" : ""
                }`}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (!disabled) switchChain?.({ chainId: allowedNetwork.id });
                }}
              >
                <ArrowsRightLeftIcon className="h-6 w-4 ml-2 sm:ml-0" />
                <span>{disabled ? `${allowedNetwork.name} (Coming Soon)` : `Switch to ${allowedNetwork.name}`}</span>
              </button>
            </li>
          );
        })}
    </>
  );
};
