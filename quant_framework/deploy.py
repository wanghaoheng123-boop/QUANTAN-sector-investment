"""
Exchange connectivity stubs for production deployment.

Provides abstract interface and stub implementations for:
- CTP (China Financial Futures Exchange / 中国金融期货交易所)
- GoldMiner (掘金量化) — REST-based quant trading interface

These are interface definitions and mock implementations. Replace with
real SDK integrations (openctp-ctp, gm-python-sdk) for live trading.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class Order:
    """Order response from exchange."""

    order_id: str
    symbol: str
    direction: str  # 'buy' | 'sell'
    quantity: int
    price: float | None  # None for market orders
    status: str  # 'pending', 'filled', 'cancelled', 'rejected'
    filled_qty: int = 0
    avg_fill_price: float = 0.0
    created_at: str = ""


@dataclass
class Position:
    """Current position in an instrument."""

    symbol: str
    direction: str  # 'long' | 'short'
    quantity: int
    avg_cost: float
    current_price: float
    unrealized_pnl: float
    margin_used: float = 0.0


@dataclass
class Account:
    """Account summary."""

    account_id: str
    total_equity: float
    available_cash: float
    frozen_margin: float
    total_pnl: float
    total_pnl_pct: float


class ExchangeConnection(ABC):
    """
    Abstract base class for exchange connectivity.

    Implement this for each exchange/broker (CTP, GoldMiner, IB, etc.).
    """

    @abstractmethod
    def connect(self) -> bool:
        """Establish connection. Returns True on success."""
        ...

    @abstractmethod
    def disconnect(self) -> None:
        """Close connection gracefully."""
        ...

    @abstractmethod
    def place_order(
        self,
        symbol: str,
        direction: str,
        quantity: int,
        price: float | None = None,
    ) -> Order:
        """
        Place an order.

        Args:
            symbol: Exchange ticker (e.g. 'IF2406' for CTP, 'SHSE.600519' for GoldMiner)
            direction: 'buy' or 'sell'
            quantity: Number of shares/contracts
            price: Limit price, or None for market order

        Returns:
            Order with generated order_id
        """
        ...

    @abstractmethod
    def cancel_order(self, order_id: str) -> bool:
        """Cancel an open order. Returns True on success."""
        ...

    @abstractmethod
    def get_positions(self) -> list[Position]:
        """Return current positions."""
        ...

    @abstractmethod
    def get_account(self) -> Account:
        """Return account summary."""
        ...


class CTPConnection(ExchangeConnection):
    """
    CTP (China Financial Futures Exchange) connection stub.

    In production, replace with openctp-ctp or similar SDK::

        from openctp_ctp import tdapi
        # Implement CTP-specific TD API callbacks here

    This stub logs all operations and returns mock responses for testing.
    """

    def __init__(
        self,
        broker_id: str = "9999",
        user_id: str = "",
        password: str = "",
        app_id: str = "",
        auth_code: str = "",
        front_addr: str = "tcp://180.168.146.187:10130",
    ) -> None:
        self.broker_id = broker_id
        self.user_id = user_id
        self.password = password
        self.app_id = app_id
        self.auth_code = auth_code
        self.front_addr = front_addr
        self._connected = False
        self._request_id = 0
        self._orders: dict[str, Order] = {}
        self._positions: dict[str, Position] = {}

    def connect(self) -> bool:
        logger.info(
            "CTP stub: connecting to %s (broker=%s, user=%s)",
            self.front_addr, self.broker_id, self.user_id,
        )
        self._connected = True
        return True

    def disconnect(self) -> None:
        logger.info("CTP stub: disconnecting")
        self._connected = False

    def _next_order_id(self) -> str:
        self._request_id += 1
        return f"CTP-{datetime.now().strftime('%Y%m%d')}-{self._request_id:06d}"

    def place_order(
        self,
        symbol: str,
        direction: str,
        quantity: int,
        price: float | None = None,
    ) -> Order:
        if not self._connected:
            raise ConnectionError("CTP not connected")

        oid = self._next_order_id()
        order = Order(
            order_id=oid,
            symbol=symbol,
            direction=direction,
            quantity=quantity,
            price=price,
            status="filled",
            filled_qty=quantity,
            avg_fill_price=price or 100.0,
            created_at=datetime.now().isoformat(),
        )
        self._orders[oid] = order
        logger.info("CTP stub: placed %s %s %d@%s → %s", direction, symbol, quantity, price, oid)
        return order

    def cancel_order(self, order_id: str) -> bool:
        if order_id in self._orders:
            self._orders[order_id].status = "cancelled"
            logger.info("CTP stub: cancelled %s", order_id)
            return True
        return False

    def get_positions(self) -> list[Position]:
        return list(self._positions.values())

    def get_account(self) -> Account:
        equity = 1_000_000.0
        return Account(
            account_id=self.user_id or "CTP-STUB",
            total_equity=equity,
            available_cash=equity * 0.7,
            frozen_margin=equity * 0.3,
            total_pnl=0.0,
            total_pnl_pct=0.0,
        )


class GoldMinerConnection(ExchangeConnection):
    """
    GoldMiner (掘金量化) connection stub.

    In production, replace with gm-python-sdk::

        from gm.api import set_token, trade
        set_token("your_token")
        # Use gm trading API here

    This stub provides mock responses for testing and development.
    """

    def __init__(
        self,
        token: str = "",
        mode: int = 1,  # 1=live, 2=backtest
    ) -> None:
        self.token = token
        self.mode = mode
        self._connected = False
        self._order_counter = 0
        self._orders: dict[str, Order] = {}
        self._positions: dict[str, Position] = {}

    def connect(self) -> bool:
        logger.info("GoldMiner stub: connecting (mode=%d)", self.mode)
        self._connected = True
        return True

    def disconnect(self) -> None:
        logger.info("GoldMiner stub: disconnecting")
        self._connected = False

    def _next_order_id(self) -> str:
        import uuid

        return f"GM-{uuid.uuid4().hex[:12]}"

    def place_order(
        self,
        symbol: str,
        direction: str,
        quantity: int,
        price: float | None = None,
    ) -> Order:
        if not self._connected:
            raise ConnectionError("GoldMiner not connected")

        oid = self._next_order_id()
        order = Order(
            order_id=oid,
            symbol=symbol,
            direction=direction,
            quantity=quantity,
            price=price,
            status="filled",
            filled_qty=quantity,
            avg_fill_price=price or 100.0,
            created_at=datetime.now().isoformat(),
        )
        self._orders[oid] = order
        logger.info("GoldMiner stub: placed %s %s %d@%s → %s", direction, symbol, quantity, price, oid)

        # Track position
        pos_key = f"{symbol}_{direction}"
        if pos_key in self._positions:
            self._positions[pos_key].quantity += quantity
        else:
            self._positions[pos_key] = Position(
                symbol=symbol,
                direction=direction,
                quantity=quantity,
                avg_cost=price or 100.0,
                current_price=price or 100.0,
                unrealized_pnl=0.0,
            )

        return order

    def cancel_order(self, order_id: str) -> bool:
        if order_id in self._orders:
            self._orders[order_id].status = "cancelled"
            logger.info("GoldMiner stub: cancelled %s", order_id)
            return True
        return False

    def get_positions(self) -> list[Position]:
        return list(self._positions.values())

    def get_account(self) -> Account:
        equity = 500_000.0
        return Account(
            account_id="GM-STUB",
            total_equity=equity,
            available_cash=equity * 0.8,
            frozen_margin=equity * 0.2,
            total_pnl=0.0,
            total_pnl_pct=0.0,
        )
