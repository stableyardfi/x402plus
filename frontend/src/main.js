import { Aptos, AptosConfig, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';
import Safe from '@safe-global/protocol-kit';

// ─────────────────────────────────────────────────────────────────────────────
// DOM Elements
// ─────────────────────────────────────────────────────────────────────────────
const logEl = document.getElementById('log');
const connectBtn = document.getElementById('connectBtn');
const accountLabel = document.getElementById('accountLabel');
const backendUrlInput = document.getElementById('backendUrl');
const facilitatorUrlInput = document.getElementById('facilitatorUrl');
const statusBadgeEl = document.getElementById('statusBadge');
const exactStatusBadgeEl = document.getElementById('exactStatusBadge');
const payIntentBtn = document.getElementById('payIntentBtn');
const payIntentBtnText = document.getElementById('payIntentBtnText');
const payExactBtn = document.getElementById('payExactBtn');
const networkSelect = document.getElementById('networkSelect');
const movementPrivKeyInput = document.getElementById('movementPrivKey');
const movementPrivRow = document.getElementById('movementPrivRow');
const modal = document.getElementById('modal');
const modalImg = document.getElementById('modalImg');
const modalMeta = document.getElementById('modalMeta');
const modalClose = document.getElementById('modalClose');
const exactResourceUrl = document.getElementById('exactResourceUrl');
const intentResourceUrl = document.getElementById('intentResourceUrl');

// x402plus Intent Section Elements
const substepAccount = document.getElementById('substepAccount');
const substepActivate = document.getElementById('substepActivate');
const substepDeposit = document.getElementById('substepDeposit');
const substepPay = document.getElementById('substepPay');
const createAccountBtn = document.getElementById('createAccountBtn');
const activateVaultBtn = document.getElementById('activateVaultBtn');
const refreshBalanceBtn = document.getElementById('refreshBalanceBtn');
const accountStatusBadge = document.getElementById('accountStatusBadge');
const activateStatusBadge = document.getElementById('activateStatusBadge');
const balanceBadge = document.getElementById('balanceBadge');
const depositAddressesEl = document.getElementById('depositAddresses');
const vaultAddressDisplay = document.getElementById('vaultAddressDisplay');
const vaultAddressText = document.getElementById('vaultAddressText');
const vaultLinkBtn = document.getElementById('vaultLinkBtn');

// Steps
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const step3Title = document.getElementById('step3Title');
const cardExact = document.getElementById('cardExact');
const cardIntent = document.getElementById('cardIntent');
const exactSection = document.getElementById('exactSection');
const intentSection = document.getElementById('intentSection');

let currentAccount = null;
let selectedType = null; // 'exact' or 'intent'
let vaultData = null;

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function log(msg, obj) {
  const time = new Date().toLocaleTimeString();
  const line = typeof obj !== 'undefined' ? `${msg} ${JSON.stringify(obj, null, 2)}` : msg;
  logEl.textContent += `[${time}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function toBase64Json(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}

function u8ToBase64(u8) {
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary);
}

function normalizeMoveAddress(addr) {
  const s = String(addr || '').toLowerCase();
  const no0x = s.startsWith('0x') ? s.slice(2) : s;
  return '0x' + no0x.padStart(64, '0');
}

async function postJson(url, data) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || `POST ${url} failed (${resp.status})`);
  return json;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function randomHex(bytes) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return '0x' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getChainIdHex() {
  return await window.ethereum.request({ method: 'eth_chainId' });
}

function shortAddr(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Network Switching
// ─────────────────────────────────────────────────────────────────────────────
function networkToChainParams(network) {
  const networks = {
    // Mainnets
    'ethereum': {
      chainId: '0x1',
      chainName: 'Ethereum Mainnet',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://eth.drpc.org'],
      blockExplorerUrls: ['https://etherscan.io']
    },
    'polygon': {
      chainId: '0x89',
      chainName: 'Polygon',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: ['https://polygon-rpc.com'],
      blockExplorerUrls: ['https://polygonscan.com']
    },
    'base': {
      chainId: '0x2105',
      chainName: 'Base',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.base.org'],
      blockExplorerUrls: ['https://basescan.org']
    },
    // Testnets
    'polygon-amoy': {
      chainId: '0x13882',
      chainName: 'Polygon Amoy',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: ['https://polygon-amoy-bor-rpc.publicnode.com'],
      blockExplorerUrls: ['https://amoy.polygonscan.com']
    },
    'base-sepolia': {
      chainId: '0x14A34',
      chainName: 'Base Sepolia',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://base-sepolia-rpc.publicnode.com'],
      blockExplorerUrls: ['https://sepolia.basescan.org']
    }
  };
  return networks[network] || null;
}

async function ensureNetwork(network) {
  const params = networkToChainParams(network);
  if (!params) return;
  const current = await getChainIdHex();
  if (current?.toLowerCase() === params.chainId.toLowerCase()) return;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: params.chainId }] });
  } catch {
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [params] });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Management
// ─────────────────────────────────────────────────────────────────────────────
function completeStep(step) {
  step.classList.remove('disabled');
  step.classList.add('completed');
}

function enableStep(step) {
  step.classList.remove('disabled', 'hidden');
}

function disableStep(step) {
  step.classList.add('disabled');
  step.classList.remove('completed');
}

function selectPaymentType(type) {
  selectedType = type;

  // Update card selection
  cardExact.classList.toggle('selected', type === 'exact');
  cardIntent.classList.toggle('selected', type === 'intent');

  // Show step 3
  enableStep(step3);

  // Update step 3 title and content
  if (type === 'exact') {
    step3Title.textContent = 'Configure & Pay (Exact)';
    exactSection.classList.remove('hidden');
    intentSection.classList.add('hidden');
  } else {
    step3Title.textContent = 'x402plus Money Account';
    exactSection.classList.add('hidden');
    intentSection.classList.remove('hidden');
    // Reset to initial state
    resetIntentFlow();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet Connection
// ─────────────────────────────────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    alert('No wallet found. Please install MetaMask.');
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    currentAccount = accounts[0];
    accountLabel.innerHTML = `<span class="connected-badge">${currentAccount.slice(0,6)}...${currentAccount.slice(-4)}</span>`;
    log('Wallet connected:', currentAccount);

    // Complete step 1, enable step 2
    completeStep(step1);
    enableStep(step2);
    connectBtn.textContent = 'Connected';
    connectBtn.disabled = true;
  } catch (e) {
    log('Connection error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// x402plus Intent Flow
// ─────────────────────────────────────────────────────────────────────────────

function resetIntentFlow() {
  // Reset all substeps
  substepAccount.classList.remove('completed', 'hidden');
  substepAccount.classList.add('active');
  substepActivate.classList.add('hidden');
  substepActivate.classList.remove('completed', 'active');
  substepDeposit.classList.add('hidden');
  substepDeposit.classList.remove('completed', 'active');
  substepPay.classList.add('hidden');
  substepPay.classList.remove('completed', 'active');

  accountStatusBadge.textContent = 'Not Created';
  accountStatusBadge.className = 'badge badge-info';
  createAccountBtn.disabled = false;
  createAccountBtn.querySelector('span').textContent = '🏦';

  // Hide vault address display
  vaultAddressDisplay.classList.add('hidden');
  vaultAddressText.textContent = '';

  vaultData = null;
}

// Show vault address in Money Account section
function showVaultAddress(vaultAddress) {
  if (vaultAddress && vaultAddressDisplay && vaultAddressText) {
    const polygonscanUrl = `https://polygonscan.com/address/${vaultAddress}`;
    vaultAddressText.textContent = vaultAddress;
    vaultAddressText.title = `View on Polygonscan: ${vaultAddress}`;
    vaultAddressText.href = polygonscanUrl;
    if (vaultLinkBtn) vaultLinkBtn.href = polygonscanUrl;
    vaultAddressDisplay.classList.remove('hidden');
    log('Vault address:', vaultAddress);
  }
}

// Step 1: Create Money Account
async function createMoneyAccount() {
  if (!currentAccount) return;

  const facUrl = facilitatorUrlInput.value.replace(/\/$/, '');
  if (!facUrl) {
    log('Error: Facilitator URL required');
    return;
  }

  try {
    createAccountBtn.disabled = true;
    createAccountBtn.innerHTML = '<span>⏳</span> Creating...';
    accountStatusBadge.textContent = 'Creating...';
    accountStatusBadge.className = 'badge badge-warning';

    log('Creating Money Account...');
    const vault = await postJson(`${facUrl}/account`, { userAddress: currentAccount });
    log('Vault response:', vault);

    vaultData = vault;

    // Check vault status
    const txData = vault.signing?.txData || vault.txData;
    const vaultAddress = vault.accountAddress || vault.signing?.vaultAddress;
    const depositAddress = vault.depositAddress;

    if (txData) {
      // Vault exists but needs activation
      vaultData = {
        activated: false,
        vaultAddress,
        depositAddress,
        txData,
        message: vault.signing?.message || vault.message,
        balance: vault.balance
      };

      // Mark account step complete, show activation step
      substepAccount.classList.remove('active');
      substepAccount.classList.add('completed');
      accountStatusBadge.textContent = 'Created';
      accountStatusBadge.className = 'badge badge-success';
      createAccountBtn.innerHTML = '<span>✓</span> Created';

      // Show vault address in Money Account section
      showVaultAddress(vaultAddress);

      // Show activation step
      substepActivate.classList.remove('hidden');
      substepActivate.classList.add('active');
      activateStatusBadge.textContent = 'Needs Activation';
      activateStatusBadge.className = 'badge badge-warning';

      log('Vault needs activation:', vaultAddress);

    } else if (vault.activated && vaultAddress) {
      // Vault is fully activated
      vaultData = {
        activated: true,
        vaultAddress,
        depositAddress,
        balance: vault.balance
      };

      // Mark account step complete
      substepAccount.classList.remove('active');
      substepAccount.classList.add('completed');
      accountStatusBadge.textContent = 'Created';
      accountStatusBadge.className = 'badge badge-success';
      createAccountBtn.innerHTML = '<span>✓</span> Created';

      // Show vault address in Money Account section
      showVaultAddress(vaultAddress);

      // Skip activation, go to deposit
      showDepositStep(vault.balance, depositAddress);

      log('Vault already activated:', vaultAddress);
    } else {
      throw new Error('Unexpected vault response');
    }

  } catch (e) {
    log('Error:', e.message);
    createAccountBtn.disabled = false;
    createAccountBtn.innerHTML = '<span>🏦</span> Create Money Account';
    accountStatusBadge.textContent = 'Error';
    accountStatusBadge.className = 'badge badge-error';
  }
}

// Step 2: Activate Vault
async function activateVault() {
  if (!vaultData?.txData) return;

  const { vaultAddress, txData } = vaultData;
  const facUrl = facilitatorUrlInput.value.replace(/\/$/, '');
  log('Activating vault:', vaultAddress);

  try {
    activateVaultBtn.disabled = true;
    activateVaultBtn.innerHTML = '<span>⏳</span> Switching network...';
    activateStatusBadge.textContent = 'Activating...';

    await ensureNetwork('polygon');

    activateVaultBtn.innerHTML = '<span>⏳</span> Initializing Safe...';
    const protocolKit = await Safe.init({
      provider: window.ethereum,
      signer: currentAccount,
      safeAddress: vaultAddress
    });

    activateVaultBtn.innerHTML = '<span>⏳</span> Creating tx...';
    const safeTx = await protocolKit.createTransaction({
      transactions: [{
        to: txData.to,
        value: txData.value || '0',
        data: txData.data,
        operation: txData.operation || 0
      }]
    });

    activateVaultBtn.innerHTML = '<span>⏳</span> Sign in wallet...';
    const safeTxHash = await protocolKit.getTransactionHash(safeTx);
    log('Safe tx hash:', safeTxHash);

    const signature = await protocolKit.signHash(safeTxHash);
    log('Signature obtained');

    activateVaultBtn.innerHTML = '<span>⏳</span> Deploying module...';
    const deployResult = await postJson(`${facUrl}/deploy-module`, {
      userAddress: currentAccount,
      signature: signature.data || signature,
      txData: txData
    });
    log('Deploy result:', deployResult);

    if (deployResult.success) {
      log('Vault activated!');

      // Mark activation complete
      substepActivate.classList.remove('active');
      substepActivate.classList.add('completed');
      activateStatusBadge.textContent = 'Activated';
      activateStatusBadge.className = 'badge badge-success';
      activateVaultBtn.innerHTML = '<span>✓</span> Activated';

      vaultData.activated = true;

      // Fetch updated account info (includes balance and deposit address)
      const accountResp = await postJson(`${facUrl}/account`, { userAddress: currentAccount });
      vaultData.depositAddress = accountResp.depositAddress;
      showDepositStep(accountResp.balance, accountResp.depositAddress);

    } else {
      throw new Error(deployResult.error || 'Deploy failed');
    }
  } catch (e) {
    log('Error:', e.message);
    activateVaultBtn.disabled = false;
    activateVaultBtn.innerHTML = '<span>✍️</span> Sign & Activate';
    activateStatusBadge.textContent = 'Failed';
    activateStatusBadge.className = 'badge badge-error';
  }
}

// Step 3: Show Deposit Step
function showDepositStep(balance, depositAddress) {
  substepDeposit.classList.remove('hidden');
  substepDeposit.classList.add('active');

  const usd = parseFloat(balance?.totalUsd || '0').toFixed(2);
  balanceBadge.textContent = `$${usd}`;
  balanceBadge.className = parseFloat(usd) > 0 ? 'badge badge-success' : 'badge badge-warning';

  // Display only deposit address in deposit section
  if (depositAddress) {
    depositAddressesEl.innerHTML = `
      <div class="deposit-row">
        <span class="deposit-chain">All Chains</span>
        <span class="deposit-address" title="${depositAddress}">${depositAddress}</span>
        <button class="copy-btn" onclick="copyAddress('${depositAddress}', this)">Copy</button>
      </div>
      <p style="font-size: 12px; color: #64748b; margin-top: 0.5rem;">
        Send USDC or USDT on Polygon, Base, or other supported chains to this address.
      </p>
    `;
    log('Deposit address:', depositAddress);
  } else {
    depositAddressesEl.innerHTML = '<div class="deposit-loading">No deposit address available</div>';
  }

  // Show pay step
  substepPay.classList.remove('hidden');

  // Enable pay button if balance > 0
  updatePayButton(parseFloat(usd));
}

// Global copy function
window.copyAddress = function(address, btn) {
  navigator.clipboard.writeText(address).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
};

async function refreshBalance() {
  const facUrl = facilitatorUrlInput.value.replace(/\/$/, '');

  refreshBalanceBtn.disabled = true;
  refreshBalanceBtn.innerHTML = '<span>⏳</span> Refreshing...';

  try {
    const balanceResp = await postJson(`${facUrl}/balance`, { userAddress: currentAccount });
    log('Balance:', balanceResp);

    const usd = parseFloat(balanceResp?.totalUsd || '0').toFixed(2);
    balanceBadge.textContent = `$${usd}`;
    balanceBadge.className = parseFloat(usd) > 0 ? 'badge badge-success' : 'badge badge-warning';

    updatePayButton(parseFloat(usd));

  } catch (e) {
    log('Error:', e.message);
  } finally {
    refreshBalanceBtn.disabled = false;
    refreshBalanceBtn.innerHTML = '<span>🔄</span> Refresh Balance';
  }
}

function updatePayButton(balance) {
  if (balance > 0) {
    payIntentBtn.disabled = false;
    payIntentBtnText.textContent = 'Pay with Intent';
    substepPay.classList.add('active');
  } else {
    payIntentBtn.disabled = true;
    payIntentBtnText.textContent = 'Deposit First';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent Payment
// ─────────────────────────────────────────────────────────────────────────────
async function payWithIntent() {
  const backendBase = backendUrlInput?.value?.replace(/\/$/, '') || 'http://localhost:4000';
  const url = `${backendBase}/api/premium-image`;

  try {
    setStatus('Requesting 402...');
    const r1 = await fetch(`${url}?x402Type=intent`);
    if (r1.status !== 402) {
      log('Unexpected:', r1.status);
      return;
    }

    const pr = await r1.json();
    log('Payment required:', pr);
    const accepts = pr.accepts?.find(a => a.scheme === 'intent') || pr.accepts?.[0];
    if (!accepts) return;

    setStatus('Sign intent...');
    const xPayment = await buildIntentPayment(accepts);

    setStatus('Sending...');
    const r2 = await fetch(url, { headers: { 'X-PAYMENT': xPayment } });

    if (r2.headers.get('X-PAYMENT-RESPONSE')) {
      const decoded = JSON.parse(atob(r2.headers.get('X-PAYMENT-RESPONSE')));
      log('Response:', decoded);
      modalMeta.textContent = `Transaction: ${decoded.transaction || 'completed'}`;
    }

    if (r2.ok) {
      const blob = await r2.blob();
      modalImg.src = URL.createObjectURL(blob);
      modal.classList.add('visible');
      setStatus('Paid! ✓');

      // Refresh balance after payment
      setTimeout(() => refreshBalance(), 2000);
    } else {
      log('Failed');
      setStatus('Failed');
    }
  } catch (e) {
    log('Error:', e.message);
    setStatus('Error');
  }
}

async function buildIntentPayment(accepts) {
  await ensureNetwork(accepts.network);
  const chainIdHex = await getChainIdHex();
  const chainId = parseInt(chainIdHex, 16);

  // Stableyard uses "settlement" as domain name
  const domain = {
    name: 'settlement',
    version: '1',
    chainId
  };

  // Include destinationChainID and destinationToken for cross-chain settlement
  const types = {
    PaymentAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'destinationChainID', type: 'uint256' },
      { name: 'destinationToken', type: 'string' }
    ]
  };

  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const nonce = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  const validAfter = nowSeconds() - 60;
  const validBefore = nowSeconds() + (accepts.maxTimeoutSeconds || 120);

  // Authorization includes destination chain and token for cross-chain payments
  const authorization = {
    from: currentAccount,
    to: accepts.payTo,
    value: String(accepts.maxAmountRequired),
    validAfter,
    validBefore,
    nonce,
    destinationChainID: 2,  // Default destination chain
    destinationToken: 'USDC'
  };

  const data = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' }
      ],
      ...types
    },
    domain,
    primaryType: 'PaymentAuthorization',
    message: authorization
  };

  log('Signing PaymentAuthorization:', authorization);

  const signature = await window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [currentAccount, JSON.stringify(data)]
  });

  return toBase64Json({
    x402Version: 1,
    scheme: 'intent',
    network: accepts.network,
    resource: accepts.resource,
    payload: {
      signature,
      format: 'eip712',
      authorization,
      domain,
      types,
      primaryType: 'PaymentAuthorization'
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exact Payment
// ─────────────────────────────────────────────────────────────────────────────
async function payExact() {
  if (!currentAccount) {
    alert('Connect wallet first');
    return;
  }
  const network = networkSelect.value;
  if (network === 'movement' || network === 'movement-mainnet' || network === 'movement-testnet') {
    await payMovement();
  } else {
    await payEVM();
  }
}

async function payEVM() {
  const backendBase = backendUrlInput.value.replace(/\/$/, '');
  const url = `${backendBase}/api/premium-image`;

  try {
    setExactStatus('Requesting 402...');
    const r1 = await fetch(url);
    if (r1.status !== 402) { log('Unexpected:', r1.status); return; }

    const pr = await r1.json();
    log('Payment required:', pr);
    const accepts = pr.accepts?.[0];
    if (!accepts) return;

    setExactStatus('Sign tx...');
    await ensureNetwork(accepts.network);
    const chainIdHex = await getChainIdHex();
    const chainId = parseInt(chainIdHex, 16);

    const domain = {
      name: accepts.extra?.name || 'USDC',
      version: accepts.extra?.version || '2',
      chainId: chainId,
      verifyingContract: accepts.asset
    };

    const validBefore = nowSeconds() + 120;
    const validAfter = nowSeconds() - 600;
    const nonce = randomHex(32);

    log('EIP-712 Domain:', domain);

    const message = { from: currentAccount, to: accepts.payTo, value: accepts.maxAmountRequired, validAfter, validBefore, nonce };

    const data = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
        TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }]
      },
      domain,
      primaryType: 'TransferWithAuthorization',
      message
    };

    const signature = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [currentAccount, JSON.stringify(data)] });
    log('Signature obtained');

    const authorization = {
      from: currentAccount,
      to: accepts.payTo,
      value: String(message.value),
      validAfter: String(validAfter),
      validBefore: String(validBefore),
      nonce
    };

    const header = toBase64Json({
      x402Version: 1,
      scheme: 'exact',
      network: accepts.network,
      payload: { signature, authorization }
    });

    setExactStatus('Sending...');
    const r2 = await fetch(url, { headers: { 'X-PAYMENT': header } });

    if (r2.ok) {
      const blob = await r2.blob();
      modalImg.src = URL.createObjectURL(blob);
      modal.classList.add('visible');
      setExactStatus('Paid! ✓');
    } else {
      setExactStatus('Failed');
    }
  } catch (e) {
    log('Error:', e.message);
    setExactStatus('Error');
  }
}

async function payMovement() {
  const backendBase = backendUrlInput.value.replace(/\/$/, '');
  const url = `${backendBase}/api/premium-image-movement`;
  const privHex = movementPrivKeyInput?.value?.trim();

  if (!privHex) { alert('Movement private key required'); return; }

  try {
    setExactStatus('Requesting 402...');
    const r1 = await fetch(url);
    if (r1.status !== 402) { log('Unexpected:', r1.status); return; }

    const pr = await r1.json();
    const accepts = pr.accepts?.[0];
    if (!accepts) return;

    setExactStatus('Building tx...');
    const isMainnet = accepts.network === 'movement' || accepts.network === 'movement-mainnet';
    const rpcUrl = isMainnet ? 'https://mainnet.movementnetwork.xyz/v1' : 'https://aptos.testnet.porto.movementlabs.xyz/v1';
    const config = new AptosConfig({ fullnode: rpcUrl });
    const aptos = new Aptos(config);
    const account = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(privHex) });

    const transaction = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: { function: '0x1::aptos_account::transfer', functionArguments: [normalizeMoveAddress(accepts.payTo), accepts.maxAmountRequired] }
    });

    const authenticator = aptos.transaction.sign({ signer: account, transaction });

    const header = toBase64Json({
      x402Version: 1,
      scheme: 'exact',
      network: accepts.network,
      payload: { signature: u8ToBase64(authenticator.bcsToBytes()), transaction: u8ToBase64(transaction.bcsToBytes()) }
    });

    setExactStatus('Sending...');
    const r2 = await fetch(url, { headers: { 'X-PAYMENT': header } });

    if (r2.ok) {
      const blob = await r2.blob();
      modalImg.src = URL.createObjectURL(blob);
      modal.classList.add('visible');
      setExactStatus('Paid! ✓');
    } else {
      setExactStatus('Failed');
    }
  } catch (e) {
    log('Error:', e.message);
    setExactStatus('Error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────────────────────────────────────
function setStatus(text) {
  if (statusBadgeEl) {
    statusBadgeEl.textContent = text;
    statusBadgeEl.className = 'badge ' + (text.includes('✓') ? 'badge-success' : text.includes('Error') || text.includes('Failed') ? 'badge-error' : 'badge-info');
  }
}

function setExactStatus(text) {
  if (exactStatusBadgeEl) {
    exactStatusBadgeEl.textContent = text;
    exactStatusBadgeEl.className = 'badge ' + (text.includes('✓') ? 'badge-success' : text.includes('Error') || text.includes('Failed') ? 'badge-error' : 'badge-info');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────────────────────────────────────────
connectBtn.addEventListener('click', connectWallet);
payExactBtn?.addEventListener('click', payExact);

// x402plus flow buttons
createAccountBtn?.addEventListener('click', createMoneyAccount);
activateVaultBtn?.addEventListener('click', activateVault);
refreshBalanceBtn?.addEventListener('click', refreshBalance);
payIntentBtn?.addEventListener('click', payWithIntent);

cardExact.addEventListener('click', () => selectPaymentType('exact'));
cardIntent.addEventListener('click', () => selectPaymentType('intent'));

networkSelect?.addEventListener('change', () => {
  const net = networkSelect.value;
  const isMovement = net === 'movement' || net === 'movement-mainnet' || net === 'movement-testnet';
  movementPrivRow.classList.toggle('hidden', !isMovement);
  updateResourceUrls();
});

backendUrlInput?.addEventListener('input', updateResourceUrls);

function updateResourceUrls() {
  const base = backendUrlInput?.value?.replace(/\/$/, '') || 'http://localhost:4000';
  const net = networkSelect?.value || 'polygon-amoy';
  const isMovement = net === 'movement' || net === 'movement-mainnet' || net === 'movement-testnet';
  const endpoint = isMovement ? '/api/premium-image-movement' : '/api/premium-image';

  if (exactResourceUrl) exactResourceUrl.textContent = `${base}${endpoint}`;
  if (intentResourceUrl) intentResourceUrl.textContent = `${base}/api/premium-image`;
}

// Initialize resource URLs
updateResourceUrls();

modalClose?.addEventListener('click', () => modal.classList.remove('visible'));
modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('visible'); });
