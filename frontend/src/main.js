import { Aptos, AptosConfig } from '@aptos-labs/ts-sdk';
import Safe from '@safe-global/protocol-kit';
import { NightlyConnectAptosAdapter } from '@nightlylabs/wallet-selector-aptos';
import { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// ─────────────────────────────────────────────────────────────────────────────
// DOM Elements
// ─────────────────────────────────────────────────────────────────────────────
const logEl = document.getElementById('log');
const accountLabel = document.getElementById('accountLabel');
const backendUrlInput = document.getElementById('backendUrl');
const facilitatorUrlInput = document.getElementById('facilitatorUrl');
const statusBadgeEl = document.getElementById('statusBadge');
const exactStatusBadgeEl = document.getElementById('exactStatusBadge');
const payIntentBtn = document.getElementById('payIntentBtn');
const payIntentBtnText = document.getElementById('payIntentBtnText');
const payExactBtn = document.getElementById('payExactBtn');
const networkSelect = document.getElementById('networkSelect');
const movementWalletRow = document.getElementById('movementWalletRow');
const connectMovementBtn = document.getElementById('connectMovementBtn');
const movementAccountLabel = document.getElementById('movementAccountLabel');
const evmWalletRow = document.getElementById('evmWalletRow');
const connectEvmBtn = document.getElementById('connectEvmBtn');
const evmAccountLabel = document.getElementById('evmAccountLabel');
const connectEvmIntentBtn = document.getElementById('connectEvmIntentBtn');
const evmIntentAccountLabel = document.getElementById('evmIntentAccountLabel');
const solanaWalletRow = document.getElementById('solanaWalletRow');
const connectSolanaBtn = document.getElementById('connectSolanaBtn');
const solanaAccountLabel = document.getElementById('solanaAccountLabel');
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

// New shared elements
const resourcePriceEl = document.getElementById('resourcePrice');
const exactErrorEl = document.getElementById('exactError');
const intentErrorEl = document.getElementById('intentError');
const depositHintEl = document.getElementById('depositHint');

let currentAccount = null;
let selectedType = null; // 'exact' or 'intent'
let vaultData = null;
let lastPrice = null; // cached price from 402 response (in dollars)
let movementAdapter = null; // Nightly Connect adapter for Movement wallet
let solanaPublicKey = null; // Phantom wallet public key

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function showInlineError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideInlineError(el) {
  if (!el) return;
  el.classList.add('hidden');
  el.textContent = '';
}

function updatePriceFromAmount(amountRaw) {
  // amountRaw is in smallest unit (e.g. "100000" = $0.10 for 6-decimal USDC)
  const dollars = (Number(amountRaw) / 1_000_000).toFixed(2);
  lastPrice = dollars;
  if (resourcePriceEl) resourcePriceEl.textContent = `$${dollars}`;
  const payExactBtnEl = document.getElementById('payExactBtn');
  if (payExactBtnEl) payExactBtnEl.textContent = `Sign & Pay $${dollars}`;
  const payIntentBtnTextEl = document.getElementById('payIntentBtnText');
  if (payIntentBtnTextEl && !payIntentBtn?.disabled) payIntentBtnTextEl.textContent = `Pay $${dollars} with Intent`;
  if (depositHintEl) depositHintEl.textContent = `You need at least $${dollars} to complete this payment.`;
}

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

  // Update panel title and content
  const panelTitle = document.getElementById('payPanelTitle');
  if (type === 'exact') {
    step3Title.textContent = 'Configure & Pay (Exact)';
    if (panelTitle) panelTitle.textContent = 'Direct Payment (Exact)';
    exactSection.classList.remove('hidden');
    intentSection.classList.add('hidden');
  } else {
    step3Title.textContent = 'x402plus GRID ID';
    if (panelTitle) panelTitle.textContent = 'GRID ID Payment (Intent)';
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
    const badge = `<span class="connected-badge">${shortAddr(currentAccount)}</span>`;
    log('EVM wallet connected:', currentAccount);

    // Update navbar label
    if (accountLabel) accountLabel.innerHTML = badge;

    // Sync both EVM connect buttons (exact + intent sections)
    for (const btn of [connectEvmBtn, connectEvmIntentBtn]) {
      if (btn) { btn.textContent = 'Connected'; btn.disabled = true; }
    }
    for (const lbl of [evmAccountLabel, evmIntentAccountLabel]) {
      if (lbl) lbl.innerHTML = badge;
    }
  } catch (e) {
    log('Connection error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// x402plus Intent Flow
// ─────────────────────────────────────────────────────────────────────────────

// Update the horizontal progress tracker
function updateGridProgress(activeStep) {
  const steps = [
    { el: document.getElementById('gpCreate'), line: null },
    { el: document.getElementById('gpActivate'), line: document.getElementById('gpLine1') },
    { el: document.getElementById('gpDeposit'), line: document.getElementById('gpLine2') },
    { el: document.getElementById('gpPay'), line: document.getElementById('gpLine3') },
  ];
  const stepNames = ['create', 'activate', 'deposit', 'pay'];
  const activeIdx = stepNames.indexOf(activeStep);

  steps.forEach((s, i) => {
    if (!s.el) return;
    s.el.classList.remove('gp-active', 'gp-done');
    if (i < activeIdx) s.el.classList.add('gp-done');
    else if (i === activeIdx) s.el.classList.add('gp-active');
    if (s.line) {
      s.line.classList.toggle('gp-line-done', i <= activeIdx);
    }
  });
}

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
  createAccountBtn.innerHTML = 'Create GRID ID';

  // Hide vault address display
  vaultAddressDisplay.classList.add('hidden');
  vaultAddressText.textContent = '';

  // Reset progress tracker
  updateGridProgress('create');

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
    createAccountBtn.innerHTML = 'Creating...';
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
      createAccountBtn.innerHTML = 'Created &#10003;';

      // Show vault address in Money Account section
      showVaultAddress(vaultAddress);

      // Show activation step
      substepActivate.classList.remove('hidden');
      substepActivate.classList.add('active');
      activateStatusBadge.textContent = 'Needs Activation';
      activateStatusBadge.className = 'badge badge-warning';
      updateGridProgress('activate');

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
      createAccountBtn.innerHTML = 'Created &#10003;';

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
    createAccountBtn.innerHTML = 'Create GRID ID';
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
    activateVaultBtn.innerHTML = 'Switching network...';
    activateStatusBadge.textContent = 'Activating...';

    await ensureNetwork('polygon');

    activateVaultBtn.innerHTML = 'Initializing Safe...';
    const protocolKit = await Safe.init({
      provider: window.ethereum,
      signer: currentAccount,
      safeAddress: vaultAddress
    });

    activateVaultBtn.innerHTML = 'Creating tx...';
    const safeTx = await protocolKit.createTransaction({
      transactions: [{
        to: txData.to,
        value: txData.value || '0',
        data: txData.data,
        operation: txData.operation || 0
      }]
    });

    activateVaultBtn.innerHTML = 'Sign in wallet...';
    const safeTxHash = await protocolKit.getTransactionHash(safeTx);
    log('Safe tx hash:', safeTxHash);

    const signature = await protocolKit.signHash(safeTxHash);
    log('Signature obtained');

    activateVaultBtn.innerHTML = 'Activating GRID ID...';
    const deployResult = await postJson(`${facUrl}/activate`, {
      address: currentAccount,
      signature: signature.data || signature,
      txData: txData
    });
    log('Activation result:', deployResult);

    if (deployResult.activated || deployResult.success) {
      log('GRID ID activated!');

      // Mark activation complete
      substepActivate.classList.remove('active');
      substepActivate.classList.add('completed');
      activateStatusBadge.textContent = 'Activated';
      activateStatusBadge.className = 'badge badge-success';
      activateVaultBtn.innerHTML = 'Activated &#10003;';

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
    activateVaultBtn.innerHTML = 'Sign &amp; Activate';
    activateStatusBadge.textContent = 'Failed';
    activateStatusBadge.className = 'badge badge-error';
  }
}

// Step 3: Show Deposit Step
function showDepositStep(balance, depositAddress) {
  substepDeposit.classList.remove('hidden');
  substepDeposit.classList.add('active');
  updateGridProgress('deposit');

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
  refreshBalanceBtn.innerHTML = 'Refreshing...';

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
    refreshBalanceBtn.innerHTML = 'Refresh Balance';
  }
}

function updatePayButton(balance) {
  if (balance > 0) {
    payIntentBtn.disabled = false;
    payIntentBtnText.textContent = lastPrice ? `Pay $${lastPrice} with Intent` : 'Pay with Intent';
    substepPay.classList.add('active');
    updateGridProgress('pay');
  } else {
    payIntentBtn.disabled = true;
    payIntentBtnText.textContent = 'Deposit First';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent Payment
// ─────────────────────────────────────────────────────────────────────────────
async function payWithIntent() {
  if (!currentAccount) {
    showInlineError(intentErrorEl, 'Connect your EVM wallet first');
    return;
  }
  const backendBase = backendUrlInput?.value?.replace(/\/$/, '') || 'https://x402-backend.stableyard.fi';
  const url = `${backendBase}/api/premium-image`;
  hideInlineError(intentErrorEl);

  try {
    setStatus('Requesting 402...');
    const r1 = await fetch(url, {
      headers: { 'X-PAYER': currentAccount }
    });
    if (r1.status !== 402) {
      log('Unexpected:', r1.status);
      return;
    }

    const pr = await r1.json();
    log('Payment required:', pr);
    const accepts = pr.accepts?.find(a => a.scheme === 'intent') || pr.accepts?.[0];
    if (!accepts) return;

    // Update price from 402 response
    updatePriceFromAmount(accepts.maxAmountRequired);

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
      const errBody = await r2.text().catch(() => '');
      log(`Failed (${r2.status}):`, errBody);
      let errMsg = 'Payment failed';
      try { const parsed = JSON.parse(errBody); errMsg = parsed.error || parsed.details || errMsg; } catch {}
      showInlineError(intentErrorEl, errMsg);
      setStatus('Failed');
    }
  } catch (e) {
    log('Error:', e.message);
    showInlineError(intentErrorEl, e.message);
    setStatus('Error');
  }
}

async function buildIntentPayment(accepts) {
  const extra = accepts.extra || {};
  const eip712 = extra.eip712;
  const facilitatorUrl = accepts.facilitatorUrl || extra.facilitatorUrl || facilitatorUrlInput.value.replace(/\/$/, '');

  // If no eip712 data in 402 response, call /prepare to get quote
  let quoteData = extra;
  if (!eip712 && facilitatorUrl) {
    log('No quote in 402 response, calling /prepare...');
    const prepareResp = await postJson(`${facilitatorUrl}/prepare`, {
      from: currentAccount,
      to: accepts.payTo,
      amount: accepts.maxAmountRequired,
      network: accepts.network,
    });
    log('Prepare response:', prepareResp);

    if (prepareResp.status !== 'ready') {
      throw new Error(`GRID ID not ready: ${prepareResp.status}. Complete setup first.`);
    }
    quoteData = prepareResp;
  }

  const signData = quoteData.eip712;
  if (!signData) {
    throw new Error('No EIP-712 data available for signing. Check GRID ID setup.');
  }

  // Check quote expiry
  if (quoteData.expiresAt && nowSeconds() >= quoteData.expiresAt) {
    throw new Error('Quote expired. Please try again.');
  }

  // Switch wallet to the chain specified in the EIP-712 domain (e.g. Polygon for Stableyard vaults),
  // NOT the 402 response network (e.g. base-sepolia) — they differ for cross-chain intent payments
  const domainChainId = signData.domain?.chainId;
  if (domainChainId) {
    const chainIdToNetwork = {
      1: 'ethereum', 137: 'polygon', 8453: 'base',
      42161: 'arbitrum', 10: 'optimism',
      84532: 'base-sepolia', 80002: 'polygon-amoy',
    };
    const targetNetwork = chainIdToNetwork[domainChainId];
    if (targetNetwork) {
      await ensureNetwork(targetNetwork);
    }
  }

  const { domain, types, message, primaryType } = signData;

  // Build EIP712Domain type from domain fields
  const domainType = [];
  if (domain.name !== undefined) domainType.push({ name: 'name', type: 'string' });
  if (domain.version !== undefined) domainType.push({ name: 'version', type: 'string' });
  if (domain.chainId !== undefined) domainType.push({ name: 'chainId', type: 'uint256' });
  if (domain.verifyingContract !== undefined) domainType.push({ name: 'verifyingContract', type: 'address' });

  const fullData = {
    types: { EIP712Domain: domainType, ...types },
    domain,
    primaryType,
    message,
  };

  log('Signing Stableyard Settlement:', message);

  const signature = await window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [currentAccount, JSON.stringify(fullData)]
  });

  return toBase64Json({
    x402Version: 1,
    scheme: 'intent',
    network: accepts.network,
    payload: {
      signature,
      from: currentAccount,
      quoteId: quoteData.quoteId,
      eip712: { domain, types, message, primaryType },
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exact Payment
// ─────────────────────────────────────────────────────────────────────────────
async function payExact() {
  hideInlineError(exactErrorEl);
  const network = networkSelect.value;
  if (network === 'movement' || network === 'movement-mainnet' || network === 'movement-testnet') {
    await payMovement();
  } else if (isSolanaNetwork(network)) {
    await paySolana();
  } else {
    await payEVM();
  }
}

// USDC contract info per chain (must match packages/x402plus/src/types.ts)
const USDC_INFO = {
  ethereum: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1, name: 'USD Coin', version: '2' },
  base: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', chainId: 8453, name: 'USD Coin', version: '2' },
  polygon: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', chainId: 137, name: 'USD Coin', version: '2' },
  arbitrum: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', chainId: 42161, name: 'USD Coin', version: '2' },
  optimism: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', chainId: 10, name: 'USD Coin', version: '2' },
  'base-sepolia': { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', chainId: 84532, name: 'USDC', version: '2' },
  'polygon-amoy': { address: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', chainId: 80002, name: 'USDC', version: '2' },
};

async function payEVM() {
  if (!currentAccount) {
    showInlineError(exactErrorEl, 'Connect your EVM wallet first');
    return;
  }
  const backendBase = backendUrlInput.value.replace(/\/$/, '');
  const url = `${backendBase}/api/premium-image`;
  hideInlineError(exactErrorEl);

  try {
    setExactStatus('Requesting 402...');
    const r1 = await fetch(url);
    if (r1.status !== 402) { log('Unexpected:', r1.status); return; }

    const pr = await r1.json();
    log('Payment required:', pr);
    const accepts = pr.accepts?.find(a => a.scheme === 'exact') || pr.accepts?.[0];
    if (!accepts) return;

    // Update price from 402 response
    updatePriceFromAmount(accepts.maxAmountRequired);

    // For exact: user picks the chain via dropdown, not the 402 response
    const selectedNetwork = networkSelect.value;
    const chainInfo = USDC_INFO[selectedNetwork];
    if (!chainInfo) {
      showInlineError(exactErrorEl, `Unsupported network: ${selectedNetwork}`);
      setExactStatus('Error');
      return;
    }

    setExactStatus('Sign tx...');
    await ensureNetwork(selectedNetwork);

    const domain = {
      name: chainInfo.name,
      version: chainInfo.version,
      chainId: chainInfo.chainId,
      verifyingContract: chainInfo.address
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

    // Include the user-selected network so the middleware uses the correct chain for verify/settle
    const header = toBase64Json({
      x402Version: 1,
      scheme: 'exact',
      network: selectedNetwork,
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
      const errBody = await r2.text().catch(() => '');
      log(`Failed (${r2.status}):`, errBody);
      // Parse error for inline display
      let errMsg = 'Payment failed';
      try { const parsed = JSON.parse(errBody); errMsg = parsed.error || parsed.details || errMsg; } catch {}
      showInlineError(exactErrorEl, errMsg);
      setExactStatus('Failed');
    }
  } catch (e) {
    log('Error:', e.message);
    showInlineError(exactErrorEl, e.message);
    setExactStatus('Error');
  }
}

// Movement network config for Nightly adapter
const MOVEMENT_NETWORKS = {
  'movement': { chainId: 126, name: 'custom', url: 'https://mainnet.movementnetwork.xyz/v1', displayName: 'Movement Mainnet' },
  'movement-mainnet': { chainId: 126, name: 'custom', url: 'https://mainnet.movementnetwork.xyz/v1', displayName: 'Movement Mainnet' },
  'movement-testnet': { chainId: 250, name: 'custom', url: 'https://testnet.movementnetwork.xyz/v1', displayName: 'Movement Testnet (Bardock)' },
};

// Solana network config
const SOLANA_NETWORKS = {
  'solana': { rpcUrl: 'https://solana-rpc.publicnode.com', usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  'solana-devnet': { rpcUrl: 'https://api.devnet.solana.com', usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' },
};

function isSolanaNetwork(net) {
  return net === 'solana' || net === 'solana-devnet';
}

let lastMovementNetwork = null; // track which network the adapter was built for

// Build Nightly adapter once (lazy, on first use)
let nightlyBuildPromise = null;
function ensureNightlyAdapter() {
  if (nightlyBuildPromise) return nightlyBuildPromise;
  nightlyBuildPromise = NightlyConnectAptosAdapter.build(
    {
      appMetadata: {
        name: 'x402plus',
        description: 'x402plus HTTP 402 Payment Demo',
        icon: 'https://stableyard.fi/favicon.ico',
      },
    },
    {},
    undefined,
    {
      networkDataOverride: {
        name: 'Movement',
        icon: 'https://registry.nightly.app/networks/movement.svg',
      },
    }
  ).then(adapter => {
    movementAdapter = adapter;
    return adapter;
  });
  return nightlyBuildPromise;
}

async function connectMovementWallet() {
  try {
    if (connectMovementBtn) {
      connectMovementBtn.disabled = true;
      connectMovementBtn.textContent = 'Connecting...';
    }

    const net = networkSelect?.value || 'movement';
    const movNet = MOVEMENT_NETWORKS[net] || MOVEMENT_NETWORKS['movement'];

    // Disconnect if network changed
    if (movementAdapter && lastMovementNetwork && lastMovementNetwork !== net) {
      log('Network changed, disconnecting...');
      try { await movementAdapter.disconnect(); } catch {}
    }

    await ensureNightlyAdapter();
    lastMovementNetwork = net;

    const requestedNetwork = { chainId: movNet.chainId, name: movNet.name, url: movNet.url };

    log(`Connecting to Movement wallet (${movNet.displayName})...`);
    const response = await movementAdapter.connect(undefined, requestedNetwork);

    // Check if user approved
    if (response?.status === 'rejected') {
      throw new Error('Connection rejected by wallet');
    }

    const accountInfo = await movementAdapter.account();
    const addr = accountInfo.address.toString();
    log('Movement wallet connected:', addr);

    if (movementAccountLabel) {
      movementAccountLabel.innerHTML = `<span class="connected-badge">${shortAddr(addr)}</span>`;
    }
    if (connectMovementBtn) {
      connectMovementBtn.textContent = 'Connected';
      connectMovementBtn.disabled = true;
    }
  } catch (e) {
    log('Movement wallet error:', e.message || e);
    if (connectMovementBtn) {
      connectMovementBtn.disabled = false;
      connectMovementBtn.textContent = 'Connect Movement Wallet';
    }
    showInlineError(exactErrorEl, `Movement wallet: ${e.message || e}`);
  }
}

async function payMovement() {
  const backendBase = backendUrlInput.value.replace(/\/$/, '');
  const url = `${backendBase}/api/premium-image`;
  hideInlineError(exactErrorEl);

  if (!movementAdapter) {
    showInlineError(exactErrorEl, 'Connect your Movement wallet first');
    return;
  }

  // Check wallet is connected
  let accountInfo;
  try {
    accountInfo = await movementAdapter.account();
  } catch {
    showInlineError(exactErrorEl, 'Movement wallet not connected. Click "Connect Movement Wallet" first.');
    return;
  }

  try {
    setExactStatus('Requesting 402...');
    const r1 = await fetch(url);
    if (r1.status !== 402) { log('Unexpected:', r1.status); return; }

    const pr = await r1.json();
    log('Payment required:', pr);

    // Find the Movement exact accept matching the selected network
    const selectedNetwork = networkSelect.value;
    const accepts = pr.accepts?.find(a =>
      a.scheme === 'exact' && a.network === selectedNetwork
    ) || pr.accepts?.find(a =>
      a.scheme === 'exact' && (a.network === 'movement' || a.network === 'movement-mainnet' || a.network === 'movement-testnet')
    );

    if (!accepts) {
      showInlineError(exactErrorEl, 'Server does not support Movement payments. Set MOVEMENT_PAY_TO env var on the backend.');
      setExactStatus('Error');
      return;
    }

    updatePriceFromAmount(accepts.maxAmountRequired);

    setExactStatus('Building tx...');
    const movNet = MOVEMENT_NETWORKS[accepts.network] || MOVEMENT_NETWORKS[selectedNetwork] || MOVEMENT_NETWORKS['movement'];
    const rpcUrl = movNet.url;
    const config = new AptosConfig({ fullnode: rpcUrl });
    const aptos = new Aptos(config);

    const senderAddress = accountInfo.address.toString();
    const isNativeMove = accepts.asset === '0x1::aptos_coin::AptosCoin' || accepts.extra?.assetType === 'native';
    let transaction;
    if (isNativeMove) {
      // Native MOVE transfer
      log('Building native MOVE transfer...');
      transaction = await aptos.transaction.build.simple({
        sender: senderAddress,
        data: { function: '0x1::aptos_account::transfer', functionArguments: [normalizeMoveAddress(accepts.payTo), accepts.maxAmountRequired] }
      });
    } else {
      // USDC.e fungible asset transfer via primary_fungible_store
      log(`Building USDC.e transfer (asset: ${accepts.asset})...`);
      transaction = await aptos.transaction.build.simple({
        sender: senderAddress,
        data: {
          function: '0x1::primary_fungible_store::transfer',
          typeArguments: ['0x1::fungible_asset::Metadata'],
          functionArguments: [accepts.asset, normalizeMoveAddress(accepts.payTo), accepts.maxAmountRequired]
        }
      });
    }

    setExactStatus('Sign in wallet...');
    log('Requesting signature from Movement wallet...');
    const signResult = await movementAdapter.signTransaction(transaction);

    // signTransaction returns UserResponse<AccountAuthenticator>
    // UserResponse has { status: 'approved', args: AccountAuthenticator } or { status: 'rejected' }
    let authenticator;
    if (signResult?.status === 'rejected') {
      throw new Error('Transaction rejected by wallet');
    }
    authenticator = signResult?.args ?? signResult;

    log('Movement transaction signed');

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
      const errBody = await r2.text().catch(() => '');
      log(`Failed (${r2.status}):`, errBody);
      let errMsg = 'Payment failed';
      try { const parsed = JSON.parse(errBody); errMsg = parsed.error || parsed.details || errMsg; } catch {}
      showInlineError(exactErrorEl, errMsg);
      setExactStatus('Failed');
    }
  } catch (e) {
    log('Error:', e.message);
    showInlineError(exactErrorEl, e.message);
    setExactStatus('Error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Solana (Phantom) Wallet & Payment
// ─────────────────────────────────────────────────────────────────────────────

async function connectSolanaWallet() {
  const phantom = window.phantom?.solana || window.solana;
  if (!phantom?.isPhantom) {
    showInlineError(exactErrorEl, 'Phantom wallet not found. Please install Phantom.');
    return;
  }

  try {
    if (connectSolanaBtn) { connectSolanaBtn.disabled = true; connectSolanaBtn.textContent = 'Connecting...'; }

    const resp = await phantom.connect();
    solanaPublicKey = resp.publicKey;
    const addr = solanaPublicKey.toString();
    log('Solana wallet connected:', addr);

    if (solanaAccountLabel) solanaAccountLabel.innerHTML = `<span class="connected-badge">${shortAddr(addr)}</span>`;
    if (connectSolanaBtn) { connectSolanaBtn.textContent = 'Connected'; connectSolanaBtn.disabled = true; }

    // Warn if user selected devnet but Phantom might be on mainnet
    const selectedNet = networkSelect?.value;
    if (selectedNet === 'solana-devnet') {
      log('NOTE: For Solana devnet, make sure Phantom is set to devnet in Settings > Developer Settings');
    }
  } catch (e) {
    log('Solana wallet error:', e.message || e);
    if (connectSolanaBtn) { connectSolanaBtn.disabled = false; connectSolanaBtn.textContent = 'Connect Phantom Wallet'; }
    showInlineError(exactErrorEl, `Phantom wallet: ${e.message || e}`);
  }
}

async function paySolana() {
  if (!solanaPublicKey) {
    showInlineError(exactErrorEl, 'Connect your Phantom wallet first');
    return;
  }

  const backendBase = backendUrlInput.value.replace(/\/$/, '');
  const url = `${backendBase}/api/premium-image`;
  hideInlineError(exactErrorEl);

  try {
    setExactStatus('Requesting 402...');
    const r1 = await fetch(url);
    if (r1.status !== 402) { log('Unexpected:', r1.status); return; }

    const pr = await r1.json();
    log('Payment required:', pr);

    // Find the Solana exact accept from the 402 response
    const selectedNetwork = networkSelect.value;
    const solAccept = pr.accepts?.find(a =>
      a.scheme === 'exact' && isSolanaNetwork(a.network)
    );

    if (!solAccept) {
      showInlineError(exactErrorEl, 'Server does not support Solana payments. Set SOLANA_PAY_TO env var on the backend.');
      setExactStatus('Error');
      return;
    }

    updatePriceFromAmount(solAccept.maxAmountRequired);

    setExactStatus('Building tx...');
    // Use the network from the 402 accept (server decides), NOT the dropdown
    const acceptNetwork = solAccept.network || selectedNetwork;
    const solNet = SOLANA_NETWORKS[acceptNetwork] || SOLANA_NETWORKS['solana-devnet'];
    const connection = new Connection(solNet.rpcUrl, 'confirmed');
    const recipient = new PublicKey(solAccept.payTo);
    const amount = BigInt(solAccept.maxAmountRequired);

    log(`Solana network: ${acceptNetwork} (RPC: ${solNet.rpcUrl})`);

    // Fee payer: use facilitator's pubkey if configured, otherwise sender pays gas
    const feePayer = solAccept.extra?.feePayer;
    const feePayerPubkey = feePayer ? new PublicKey(feePayer) : solanaPublicKey;
    const facilitatorPaysGas = !!feePayer;

    if (!facilitatorPaysGas) {
      log('No feePayer configured — sender will pay gas');
    }

    // Warn user if they need to switch Phantom network
    if (acceptNetwork === 'solana-devnet') {
      log('Make sure Phantom is set to devnet (Settings > Developer Settings > Change Network > Devnet)');
    }

    // Detect native SOL vs SPL token payment
    const isNativeSol = solAccept.asset === 'So11111111111111111111111111111111111111112' || solAccept.extra?.assetType === 'native';

    let instructions;
    if (isNativeSol) {
      // Native SOL transfer via System Program
      log('Building native SOL transfer...');
      instructions = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
        SystemProgram.transfer({
          fromPubkey: solanaPublicKey,
          toPubkey: recipient,
          lamports: amount,
        }),
      ];
    } else {
      // SPL token (USDC) transfer via TransferChecked
      log('Building USDC SPL transfer...');
      const mint = new PublicKey(solAccept.asset);
      const senderAta = await getAssociatedTokenAddress(mint, solanaPublicKey);
      const recipientAta = await getAssociatedTokenAddress(mint, recipient);
      log('Sender ATA:', senderAta.toString());
      log('Recipient ATA:', recipientAta.toString());
      instructions = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
        createTransferCheckedInstruction(
          senderAta,           // source ATA
          mint,                // USDC mint
          recipientAta,        // destination ATA
          solanaPublicKey,     // owner/authority (sender)
          amount,              // amount in smallest units
          6,                   // USDC decimals
          [],                  // multi-signers (none)
          TOKEN_PROGRAM_ID     // SPL Token program
        ),
      ];
    }

    // Build versioned transaction
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    const messageV0 = new TransactionMessage({
      payerKey: feePayerPubkey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);

    setExactStatus('Sign in wallet...');
    log('Requesting Phantom signature...');
    const phantom = window.phantom?.solana || window.solana;
    const signedTx = await phantom.signTransaction(tx);

    log('Solana transaction signed');

    // Serialize and encode the partially-signed transaction
    const serialized = signedTx.serialize();
    const base64Tx = u8ToBase64(serialized);

    const header = toBase64Json({
      x402Version: 1,
      scheme: 'exact',
      network: acceptNetwork,
      payload: { transaction: base64Tx },
    });

    setExactStatus('Sending...');
    const r2 = await fetch(url, { headers: { 'X-PAYMENT': header } });

    if (r2.ok) {
      const blob = await r2.blob();
      modalImg.src = URL.createObjectURL(blob);
      modal.classList.add('visible');
      setExactStatus('Paid! ✓');
    } else {
      const errBody = await r2.text().catch(() => '');
      log(`Failed (${r2.status}):`, errBody);
      let errMsg = 'Payment failed';
      try { const parsed = JSON.parse(errBody); errMsg = parsed.error || parsed.details || errMsg; } catch {}
      showInlineError(exactErrorEl, errMsg);
      setExactStatus('Failed');
    }
  } catch (e) {
    log('Error:', e.message);
    showInlineError(exactErrorEl, e.message);
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
// EVM wallet connect buttons (exact + intent sections)
connectEvmBtn?.addEventListener('click', connectWallet);
connectEvmIntentBtn?.addEventListener('click', connectWallet);
payExactBtn?.addEventListener('click', payExact);

// x402plus flow buttons
createAccountBtn?.addEventListener('click', createMoneyAccount);
activateVaultBtn?.addEventListener('click', activateVault);
refreshBalanceBtn?.addEventListener('click', refreshBalance);
payIntentBtn?.addEventListener('click', payWithIntent);

cardExact.addEventListener('click', () => selectPaymentType('exact'));
cardIntent.addEventListener('click', () => selectPaymentType('intent'));
connectMovementBtn?.addEventListener('click', connectMovementWallet);
connectSolanaBtn?.addEventListener('click', connectSolanaWallet);

function updateWalletRows() {
  const net = networkSelect?.value || 'polygon';
  const isMovement = net === 'movement' || net === 'movement-mainnet' || net === 'movement-testnet';
  const isSolana = isSolanaNetwork(net);
  const isEvm = !isMovement && !isSolana;
  if (movementWalletRow) movementWalletRow.classList.toggle('hidden', !isMovement);
  if (solanaWalletRow) solanaWalletRow.classList.toggle('hidden', !isSolana);
  if (evmWalletRow) evmWalletRow.classList.toggle('hidden', !isEvm);
}
updateWalletRows(); // set initial state

networkSelect?.addEventListener('change', () => {
  updateWalletRows();
  updateResourceUrls();

  // Reset Movement wallet button when network changes so user reconnects on correct network
  const net = networkSelect?.value || '';
  const isMovement = net === 'movement' || net === 'movement-mainnet' || net === 'movement-testnet';
  if (isMovement && lastMovementNetwork && lastMovementNetwork !== net) {
    if (connectMovementBtn) {
      connectMovementBtn.disabled = false;
      connectMovementBtn.textContent = 'Connect Movement Wallet';
    }
    if (movementAccountLabel) movementAccountLabel.innerHTML = '';
  }
});

backendUrlInput?.addEventListener('input', updateResourceUrls);

function updateResourceUrls() {
  const base = backendUrlInput?.value?.replace(/\/$/, '') || 'https://x402-backend.stableyard.fi';
  // All networks (EVM, Solana, Movement) use the same endpoint
  if (exactResourceUrl) exactResourceUrl.textContent = `${base}/api/premium-image`;
  if (intentResourceUrl) intentResourceUrl.textContent = `${base}/api/premium-image`;
}

// Initialize resource URLs
updateResourceUrls();

// Prefetch price from backend so the resource card shows it immediately
async function prefetchPrice() {
  try {
    const base = backendUrlInput?.value?.replace(/\/$/, '') || 'https://x402-backend.stableyard.fi';
    const r = await fetch(`${base}/api/premium-image`);
    if (r.status === 402) {
      const pr = await r.json();
      const amount = pr.accepts?.[0]?.maxAmountRequired;
      if (amount) updatePriceFromAmount(amount);
    }
  } catch {
    // Backend not running yet — price will update on first payment attempt
  }
}
prefetchPrice();

// Also refetch when network changes (price might differ)
networkSelect?.addEventListener('change', prefetchPrice);

// Also refetch price when backend URL changes
backendUrlInput?.addEventListener('change', prefetchPrice);

modalClose?.addEventListener('click', () => modal.classList.remove('visible'));
modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('visible'); });
