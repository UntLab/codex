from typing import List, Optional

from pydantic import BaseModel, Field


class ContainerBase(BaseModel):
    container_id: str = Field(..., description="Unique container ID, e.g. MSKU1234567")
    container_type: str = Field(..., description="20ft, 40ft, 45ft")
    status: str = Field(..., description="Loaded or Empty")
    direction: str = Field(..., description="Import or Export")
    bonded: bool = Field(False, description="Whether the container is bonded")
    stack_out_date: Optional[str] = Field(None, description="Planned stack out date in YYYY-MM-DD format")
    weight: Optional[float] = Field(None, ge=0, description="Container weight in kilograms")
    commodity: Optional[str] = None
    line: Optional[str] = None
    expeditor: Optional[str] = None
    damages: Optional[str] = None
    seals: Optional[str] = None


class StackInRequest(ContainerBase):
    block: str
    bay: str
    row: int
    tier: int
    emergency_override: bool = False
    override_reason: Optional[str] = Field(None, description="Reason for emergency override when stacking order is broken")


class StackOutRequest(BaseModel):
    container_id: str


class RestowRequest(BaseModel):
    container_id: str
    new_block: str
    new_bay: str
    new_row: int
    new_tier: int
    emergency_override: bool = False
    override_reason: Optional[str] = Field(None, description="Reason for emergency override when stacking order is broken")


class LoginRequest(BaseModel):
    username: str
    password: str


class NotificationSettingsUpdateRequest(BaseModel):
    notifications_enabled: bool
    telegram_notifications_enabled: bool
    receive_all_movement_alerts: bool


class NotificationPreviewRequest(BaseModel):
    operation_type: str
    container_id: str


class ChangeOwnPasswordRequest(BaseModel):
    current_password: str
    new_password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    full_name: str
    role: str
    telegram_chat_id: Optional[str] = None
    notifications_enabled: bool = True
    telegram_notifications_enabled: bool = True
    receive_all_movement_alerts: bool = False


class AdminUpdateUserRoleRequest(BaseModel):
    role: str


class AdminSetPasswordRequest(BaseModel):
    new_password: str


class AdminUpdateBlockRequest(BaseModel):
    label: str
    bay_count: int
    row_count: int
    tier_count: int
    equipment: Optional[str] = None


class AdminUpdateSlotRequest(BaseModel):
    enabled: bool
    max_tiers: int
    allowed_container_types: List[str]
    notes: Optional[str] = None
