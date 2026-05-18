package com.isp.common.dto;

public record ErrorDetail(
        String field,
        String reasonCode,
        String message
) {
}
