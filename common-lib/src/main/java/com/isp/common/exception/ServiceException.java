package com.isp.common.exception;

import com.isp.common.dto.ErrorDetail;

import java.util.List;

public abstract class ServiceException extends RuntimeException {
    private final String code;
    private final List<ErrorDetail> details;

    protected ServiceException(String code, String message, List<ErrorDetail> details) {
        super(message);
        this.code = code;
        this.details = details == null ? List.of() : List.copyOf(details);
    }

    public String getCode() {
        return code;
    }

    public List<ErrorDetail> getDetails() {
        return details;
    }
}
