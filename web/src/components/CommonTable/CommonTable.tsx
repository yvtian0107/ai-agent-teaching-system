'use client'

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { Table, Pagination } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import type { ColumnsType, TableProps } from 'antd/es/table'
import type { Key } from 'react'
import './CommonTable.css'

// 分页配置
export interface PaginationConfig {
  current: number
  pageSize: number
  total: number
  onChange?: (page: number, pageSize: number) => void
  showSizeChanger?: boolean
  pageSizeOptions?: string[]
}

// 选择行配置
export interface RowSelectionConfig<T> {
  type: 'checkbox' | 'radio'
  selectedRowKeys: Key[]
  onChange: (selectedRowKeys: Key[]) => void
  getCheckboxProps?: (record: T) => { disabled?: boolean }
}

// 空状态配置
export interface EmptyConfig {
  title?: string
  description?: string
  icon?: React.ReactNode
}

// 主组件 Props
export interface CommonTableProps<T extends object> {
  // 核心属性
  columns: ColumnsType<T>
  dataSource: T[]
  rowKey: string | ((record: T) => string)
  loading?: boolean

  // 分页配置 (false 或不传则禁用)
  pagination?: PaginationConfig | false
  paginationMode?: 'client' | 'server'

  // 选择行配置 (false 或不传则禁用)
  rowSelection?: RowSelectionConfig<T> | false

  // 空状态定制
  empty?: EmptyConfig

  // 其他配置
  scroll?: { x?: number | string }
  expandable?: TableProps<T>['expandable']
  className?: string
}

// 默认分页选项
const DEFAULT_PAGE_SIZE_OPTIONS = ['10', '20', '50', '100']

// 分页区域高度（包含 padding）
const PAGINATION_HEIGHT = 56

function CommonTable<T extends object>({
  columns,
  dataSource,
  rowKey,
  loading = false,
  pagination,
  paginationMode = 'client',
  rowSelection,
  empty,
  scroll,
  expandable,
  className = '',
}: CommonTableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tableScrollY, setTableScrollY] = useState<number | undefined>(undefined)
  const paginationConfig = pagination || undefined

  // 判断是否为空数据
  const isEmpty = dataSource.length === 0

  // 判断是否显示分页：总数大于 0 时显示分页
  const shouldShowPagination = paginationConfig
    ? (paginationConfig.total > 0 || !isEmpty)
    : false

  // 计算当前页显示的数据。server 模式不做前端切片。
  const paginatedData = paginationConfig && paginationMode === 'client'
    ? dataSource.slice(
      (paginationConfig.current - 1) * paginationConfig.pageSize,
      paginationConfig.current * paginationConfig.pageSize
    )
    : dataSource

  // 计算表格可用高度
  const calculateTableHeight = useCallback(() => {
    if (!containerRef.current) return

    const containerHeight = containerRef.current.clientHeight
    // 只有在实际显示分页时才减去分页区域高度
    const paginationSpace = shouldShowPagination ? PAGINATION_HEIGHT : 0
    // 表头高度约 55px
    const headerHeight = 55
    // 可用于表格内容的高度
    const availableHeight = containerHeight - paginationSpace - headerHeight

    // 简化策略：总是设置 scroll.y，让 Ant Design 自己处理对齐
    // Ant Design 会根据实际内容决定是否显示滚动条
    if (availableHeight > 100) {
      setTableScrollY(availableHeight)
    }
  }, [shouldShowPagination])

  // 监听容器大小变化
  useEffect(() => {
    calculateTableHeight()

    const resizeObserver = new ResizeObserver(() => {
      calculateTableHeight()
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [calculateTableHeight])

  // 构建 Table 的 rowSelection 配置
  const tableRowSelection = rowSelection
    ? {
      type: rowSelection.type,
      selectedRowKeys: rowSelection.selectedRowKeys,
      onChange: (selectedKeys: Key[]) => {
        rowSelection.onChange(selectedKeys)
      },
      getCheckboxProps: rowSelection.getCheckboxProps,
    }
    : undefined

  // 构建滚动配置 - 只有需要时才设置 y
  const tableScroll = {
    x: scroll?.x,
    y: tableScrollY,
  }

  return (
    <div ref={containerRef} className={`common-table-wrapper ${isEmpty ? 'is-empty' : ''} ${className}`}>
      <div className="common-table-content">
        <Table<T>
          columns={columns}
          dataSource={paginatedData}
          rowKey={rowKey}
          loading={loading}
          pagination={false}
          rowSelection={tableRowSelection}
          scroll={tableScroll}
          expandable={expandable}
          locale={{
            emptyText: (
              <div className="common-table-empty">
                {empty?.icon || <InboxOutlined className="common-table-empty-icon" />}
                <div className="common-table-empty-title">{empty?.title || '暂无数据'}</div>
              </div>
            ),
          }}
        />
      </div>

      {shouldShowPagination && paginationConfig && (
        <div className="common-table-pagination">
          <Pagination
            current={paginationConfig.current}
            pageSize={paginationConfig.pageSize}
            total={paginationConfig.total}
            onChange={paginationConfig.onChange}
            showSizeChanger={paginationConfig.showSizeChanger ?? true}
            pageSizeOptions={paginationConfig.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS}
            showTotal={(total) => `共 ${total} 条`}
          />
        </div>
      )}
    </div>
  )
}

export default CommonTable
