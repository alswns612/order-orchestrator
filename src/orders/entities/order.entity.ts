import {
  Column,
  CreateDateColumn,
  Entity,
  OneToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { InventoryReservation } from './inventory-reservation.entity';
import { Payment } from './payment.entity';
import { Shipment } from './shipment.entity';
import { OrderStatus } from '../order-status.enum';

export interface OrderLineItem {
  sku: string;
  qty: number;
  price: number;
}

@Entity('orders')
@Unique(['idempotencyKey'])
export class Order {
  // 주문 ID는 애플리케이션에서 UUIDv7로 생성하여 저장한다.
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ length: 64 })
  customerId!: string;

  @Column({
    type: 'simple-enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status!: OrderStatus;

  @Column({ type: 'simple-json' })
  items!: OrderLineItem[];

  @Column({ type: 'integer' })
  totalAmount!: number;

  @Column({ type: 'varchar', nullable: true })
  idempotencyKey?: string | null;

  @OneToOne(() => Payment, (payment) => payment.order, { eager: true })
  payment?: Payment;

  @OneToOne(
    () => InventoryReservation,
    (inventoryReservation) => inventoryReservation.order,
    { eager: true },
  )
  inventoryReservation?: InventoryReservation;

  @OneToOne(() => Shipment, (shipment) => shipment.order, { eager: true })
  shipment?: Shipment;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
